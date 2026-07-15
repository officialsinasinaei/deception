import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useState } from "react";
import {
  useEconomy,
  buyInk,
  buyAvatar,
  selectAvatar,
  openChest,
  canOpenChestFree,
  INK_MAX,
  INK_BUY_COST,
  AVATAR_COST,
  CHEST_PAID_COST,
  DAILY_WINS_FOR_CHEST,
  type ChestReward,
} from "@/game/store";
import { sfx } from "@/game/audio";
import { AvatarBadge, TopHUD } from "./index";
import { AVATARS } from "@/game/avatars";

const searchSchema = z.object({ tab: z.enum(["ink", "avatars", "chest"]).optional() });

export const Route = createFileRoute("/shop")({
  validateSearch: (s) => searchSchema.parse(s),
  component: ShopPage,
});

function ShopPage() {
  const { tab = "ink" } = Route.useSearch();
  const eco = useEconomy();
  const [activeTab, setActiveTab] = useState<"ink" | "avatars" | "chest">(tab);
  const [reward, setReward] = useState<ChestReward | null>(null);
  const [spinning, setSpinning] = useState(false);

  const doChest = (paid: boolean) => {
    setSpinning(true);
    setReward(null);
    sfx.chest();
    setTimeout(() => {
      const r = openChest(paid);
      setReward(r);
      setSpinning(false);
    }, 2000);
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col">
      <TopHUD ink={eco.ink} coins={eco.coins} avatar={eco.selectedAvatar} />
      <div className="px-5 py-4 flex items-center justify-between">
        <Link
          to="/"
          onClick={() => sfx.click()}
          className="text-xs text-muted-foreground uppercase tracking-widest"
        >
          ← Gallery
        </Link>
        <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70">Atelier</p>
      </div>

      <div className="flex justify-center gap-1 px-5 pb-4">
        {(["ink", "avatars", "chest"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              sfx.click();
              setActiveTab(t);
              setReward(null);
            }}
            className={`flex-1 py-2 text-[10px] uppercase tracking-[0.25em] border ${
              activeTab === t
                ? "border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/10"
                : "border-[var(--gold)]/20 text-muted-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <main className="flex-1 px-5 pb-8 overflow-y-auto">
        {activeTab === "ink" && (
          <div className="space-y-4">
            <p className="text-center text-xs text-muted-foreground">
              Ink regenerates 1 unit every 45 minutes. Buy an instant unit for {INK_BUY_COST} coins.
            </p>
            <div className="border border-[var(--gold)]/30 p-6 text-center">
              <div className="text-6xl text-[var(--gold)] mb-3">◈</div>
              <div className="font-display text-2xl">One Vial of Ink</div>
              <div className="text-xs text-muted-foreground mt-1">+1 Ink (max {INK_MAX})</div>
              <button
                onClick={() => {
                  if (buyInk()) sfx.snap();
                  else sfx.penalty();
                }}
                disabled={eco.coins < INK_BUY_COST || eco.ink >= INK_MAX}
                className="mt-4 px-6 py-3 border-2 border-[var(--gold)] text-[var(--gold)] uppercase tracking-widest text-xs disabled:opacity-40 active:scale-95 transition"
              >
                ◉ {INK_BUY_COST} — Purchase
              </button>
            </div>
          </div>
        )}

        {activeTab === "avatars" && (
          <div className="grid grid-cols-3 gap-3">
            {AVATARS.map(({ id, name }) => {
              const owned = eco.ownedAvatars.includes(id);
              const selected = eco.selectedAvatar === id;
              return (
                <button
                  key={id}
                  onClick={() => {
                    sfx.click();
                    if (owned) selectAvatar(id);
                    else if (buyAvatar(id)) sfx.snap();
                    else sfx.penalty();
                  }}
                  className={`aspect-square border ${selected ? "border-[var(--gold)]" : "border-[var(--gold)]/20"} p-2 flex flex-col items-center justify-between gap-1 relative overflow-hidden`}
                >
                  <div className="w-full aspect-square overflow-hidden">
                    <AvatarBadgeLarge id={id} />
                  </div>
                  <div className="text-[8px] uppercase tracking-widest text-muted-foreground truncate w-full">
                    {name}
                  </div>
                  <div className="text-[9px] uppercase tracking-widest text-[var(--gold)]/80">
                    {selected ? "Worn" : owned ? "Own" : `◉ ${AVATAR_COST}`}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {activeTab === "chest" && (
          <div className="space-y-4">
            <div className="relative border border-[var(--gold)]/30 p-6 text-center overflow-hidden">
              {/* Rotating gold beams behind the chest while spinning / on reward. */}
              <div
                className={`chest-beams ${spinning || reward ? "chest-beams-on" : ""}`}
                aria-hidden
              />
              <div
                className={`relative mx-auto mb-3 w-28 h-28 grid place-items-center ${spinning ? "chest-spin" : reward ? "chest-pop" : ""}`}
              >
                <div className="absolute inset-0 rounded-full bg-[var(--gold)]/10 blur-xl" />
                <div className="relative text-7xl text-[var(--gold)] leading-none drop-shadow-[0_0_18px_oklch(0.78_0.13_82/0.6)]">
                  ❖
                </div>
              </div>
              <div className="font-display text-2xl italic">Masterpiece Chest</div>
              <div className="text-xs text-muted-foreground mt-1">1–5 Ink · 1–5 Coins</div>
              <div className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                Daily wins: {eco.dailyWins}/{DAILY_WINS_FOR_CHEST}
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  onClick={() => canOpenChestFree() && doChest(false)}
                  disabled={!canOpenChestFree() || spinning}
                  className="relative z-10 px-4 py-2.5 border-2 border-[var(--gold)] text-[var(--gold)] uppercase tracking-widest text-xs disabled:opacity-40"
                >
                  Open — Free
                </button>
                <button
                  onClick={() => doChest(true)}
                  disabled={eco.coins < CHEST_PAID_COST || spinning}
                  className="relative z-10 px-4 py-2.5 border border-[var(--gold)]/50 text-[var(--gold)]/80 uppercase tracking-widest text-xs disabled:opacity-40"
                >
                  Open — ◉ {CHEST_PAID_COST}
                </button>
              </div>
              {reward && (
                <div className="relative z-10 mt-4 pt-4 border-t border-[var(--gold)]/20 animate-[fade-in_0.4s_ease-out]">
                  <div className="text-[10px] uppercase tracking-widest text-[var(--gold)]">
                    Bounty
                  </div>
                  <div className="font-display text-3xl mt-1 text-[var(--gold)]">
                    ◈ +{reward.ink} · ◉ +{reward.coins}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Larger avatar for the gallery grid — full-square portrait.
function AvatarBadgeLarge({ id }: { id: number }) {
  const av = AVATARS.find((a) => a.id === id);
  if (!av) return <AvatarBadge id={id} />;
  return (
    <div className="w-full h-full overflow-hidden">
      <img
        src={av.url}
        alt={av.name}
        loading="lazy"
        width={256}
        height={256}
        className="w-full h-full object-cover"
      />
    </div>
  );
}
