// Economy store — persisted in localStorage. Simple useSyncExternalStore-based.
import { useSyncExternalStore } from "react";

export interface Economy {
  ink: number;                 // 0..10
  inkLastRegenAt: number;      // ms epoch
  coins: number;
  dailyWins: number;
  dailyWinCycleStart: number;  // ms epoch (0 = none)
  ownedAvatars: number[];      // avatar ids
  selectedAvatar: number;
  lastChestOpenAt: number;
}

export const INK_MAX = 10;
export const INK_REGEN_MS = 45 * 60 * 1000;
export const ENTRY_COIN = 1;
export const WIN_COINS = 2;
export const INK_BUY_COST = 5;
export const AVATAR_COST = 10;
export const CHEST_PAID_COST = 10;
export const DAILY_CYCLE_MS = 24 * 60 * 60 * 1000;
export const DAILY_WINS_FOR_CHEST = 5;

const KEY = "cod:economy:v1";

function makeDefault(): Economy {
  return {
    ink: 10,
    inkLastRegenAt: Date.now(),
    coins: 5,
    dailyWins: 0,
    dailyWinCycleStart: 0,
    ownedAvatars: [0],
    selectedAvatar: 0,
    lastChestOpenAt: 0,
  };
}

// Stable snapshot for SSR / hydration.
const SSR_SNAPSHOT: Economy = {
  ink: 10, inkLastRegenAt: 0, coins: 5, dailyWins: 0,
  dailyWinCycleStart: 0, ownedAvatars: [0], selectedAvatar: 0, lastChestOpenAt: 0,
};
function getServerSnapshot(): Economy { return SSR_SNAPSHOT; }

let state: Economy = makeDefault();
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...makeDefault(), ...JSON.parse(raw) };
  } catch {}
  tickRegen(false);
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

function notify() {
  listeners.forEach((l) => l());
}

function tickRegen(shouldNotify = true) {
  if (state.ink >= INK_MAX) {
    if (state.inkLastRegenAt !== Date.now()) {
      state = { ...state, inkLastRegenAt: Date.now() };
    }
  } else {
    const now = Date.now();
    const diff = now - state.inkLastRegenAt;
    const gained = Math.floor(diff / INK_REGEN_MS);
    if (gained > 0) {
      state = {
        ...state,
        ink: Math.min(INK_MAX, state.ink + gained),
        inkLastRegenAt: state.inkLastRegenAt + gained * INK_REGEN_MS,
      };
      persist();
      if (shouldNotify) notify();
    }
  }
}

// Regen ticker
if (typeof window !== "undefined") {
  setInterval(() => tickRegen(true), 30_000);
}

export function subscribe(l: () => void) {
  load();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getEconomy(): Economy {
  load();
  return state;
}

export function useEconomy(): Economy {
  return useSyncExternalStore(
    subscribe,
    getEconomy,
    getServerSnapshot,
  );
}

export function nextInkRegenMs(): number {
  load();
  if (state.ink >= INK_MAX) return 0;
  return Math.max(0, state.inkLastRegenAt + INK_REGEN_MS - Date.now());
}

function mutate(fn: (s: Economy) => void) {
  load();
  const next: Economy = { ...state, ownedAvatars: [...state.ownedAvatars] };
  fn(next);
  state = next;
  persist();
  notify();
}

export function canStartMatch(): boolean {
  load();
  // Gate on ink only so a player who has run out of coins can never be
  // soft-locked (entry still spends a coin when available — see payEntry).
  return state.ink >= 1;
}

export function payEntry() {
  mutate((s) => {
    s.coins = Math.max(0, s.coins - ENTRY_COIN);
  });
}

export function rewardWin() {
  mutate((s) => {
    s.coins += WIN_COINS;
    const now = Date.now();
    if (!s.dailyWinCycleStart || now - s.dailyWinCycleStart > DAILY_CYCLE_MS) {
      s.dailyWinCycleStart = now;
      s.dailyWins = 1;
    } else {
      s.dailyWins += 1;
    }
  });
}

export function penaltyLoss() {
  mutate((s) => {
    s.ink = Math.max(0, s.ink - 1);
    if (s.ink < INK_MAX) s.inkLastRegenAt = Date.now();
    s.dailyWins = 0;
    s.dailyWinCycleStart = 0;
  });
}

export function buyInk(): boolean {
  let ok = false;
  mutate((s) => {
    if (s.coins >= INK_BUY_COST && s.ink < INK_MAX) {
      s.coins -= INK_BUY_COST;
      s.ink += 1;
      ok = true;
    }
  });
  return ok;
}

export function buyAvatar(id: number): boolean {
  let ok = false;
  mutate((s) => {
    if (s.ownedAvatars.includes(id)) return;
    if (s.coins >= AVATAR_COST) {
      s.coins -= AVATAR_COST;
      s.ownedAvatars.push(id);
      s.selectedAvatar = id;
      ok = true;
    }
  });
  return ok;
}

export function selectAvatar(id: number) {
  mutate((s) => {
    if (s.ownedAvatars.includes(id)) s.selectedAvatar = id;
  });
}

export interface ChestReward {
  ink: number;
  coins: number;
}

export function canOpenChestFree(): boolean {
  load();
  const now = Date.now();
  const cycleActive = state.dailyWinCycleStart > 0 && now - state.dailyWinCycleStart < DAILY_CYCLE_MS;
  return cycleActive && state.dailyWins >= DAILY_WINS_FOR_CHEST && state.lastChestOpenAt < state.dailyWinCycleStart;
}

export function openChest(paid: boolean): ChestReward | null {
  let reward: ChestReward | null = null;
  mutate((s) => {
    if (paid) {
      if (s.coins < CHEST_PAID_COST) return;
      s.coins -= CHEST_PAID_COST;
    } else {
      if (!canOpenChestFree()) return;
    }
    const ink = 1 + Math.floor(Math.random() * 5);
    const coins = 1 + Math.floor(Math.random() * 5);
    s.ink = Math.min(INK_MAX, s.ink + ink);
    s.coins += coins;
    s.lastChestOpenAt = Date.now();
    reward = { ink, coins };
  });
  return reward;
}