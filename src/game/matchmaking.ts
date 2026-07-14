// Real-time PvP matchmaking against Lovable Cloud.
// Anonymous auth + `claim_or_enqueue` RPC + realtime subscription on `matches`.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { PAINTINGS } from "@/game/paintings";

export interface MatchInfo {
  matchId: string;
  role: "a" | "b";
  paintingId: string;
  opponentId: string;
  avatarOpponent: number;
  selfId: string;
}

let ensureSessionPromise: Promise<string> | null = null;

/** Ensure the browser has a Supabase session (anonymous if needed). Returns user id. */
export async function ensureAuth(): Promise<string> {
  if (ensureSessionPromise) return ensureSessionPromise;
  ensureSessionPromise = (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return data.session.user.id;
    const { data: signed, error } = await supabase.auth.signInAnonymously();
    if (error || !signed.user) throw error ?? new Error("anon sign-in failed");
    return signed.user.id;
  })();
  try {
    return await ensureSessionPromise;
  } catch (e) {
    ensureSessionPromise = null;
    throw e;
  }
}

function pickPaintingId(): string {
  return PAINTINGS[Math.floor(Math.random() * PAINTINGS.length)].id;
}

/**
 * Try to pair with the oldest waiting player, or enter the queue and wait for
 * a match row to appear. Resolves as soon as pairing succeeds. Rejects if
 * cancelled or if `timeoutMs` elapses (still leaves the queue clean).
 */
export async function findMatch(opts: {
  avatarId: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<MatchInfo> {
  const selfId = await ensureAuth();
  const paintingId = pickPaintingId();

  // Attempt immediate pairing.
  const { data: rpc, error } = await supabase.rpc("claim_or_enqueue", {
    p_avatar_id: opts.avatarId,
    p_painting_id: paintingId,
  });
  if (error) throw error;
  const result = rpc as {
    matched: boolean;
    match_id?: string;
    role?: "a" | "b";
    opponent?: string;
    painting_id?: string;
  };

  if (result.matched && result.match_id && result.role) {
    // Fetch the match row to learn opponent's avatar.
    const { data: row } = await supabase
      .from("matches")
      .select("id, player_a, player_b, avatar_a, avatar_b, painting_id")
      .eq("id", result.match_id)
      .maybeSingle();
    return {
      matchId: result.match_id,
      role: result.role,
      paintingId: row?.painting_id ?? paintingId,
      opponentId: result.opponent ?? "",
      avatarOpponent: result.role === "b" ? (row?.avatar_a ?? 0) : (row?.avatar_b ?? 0),
      selfId,
    };
  }

  // We're in the queue; wait for an insert on `matches` naming us as player_a.
  return new Promise<MatchInfo>((resolve, reject) => {
    let done = false;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let pollHandle: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      if (done) return;
      done = true;
      if (channel) void supabase.removeChannel(channel);
      if (pollHandle) clearInterval(pollHandle);
      clearTimeout(timeoutHandle);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (info: MatchInfo) => { cleanup(); resolve(info); };
    const fail = (err: unknown) => {
      cleanup();
      // Best-effort queue removal.
      void supabase.rpc("cancel_queue").then(() => {}, () => {});
      reject(err);
    };
    const onAbort = () => fail(new Error("cancelled"));
    opts.signal?.addEventListener("abort", onAbort);

    const timeoutHandle = setTimeout(
      () => fail(new Error("timeout")),
      opts.timeoutMs ?? 20000,
    );

    channel = supabase
      .channel(`mm:${selfId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "matches",
          filter: `player_a=eq.${selfId}`,
        },
        (payload) => {
          const r = payload.new as {
            id: string;
            player_b: string;
            avatar_b: number;
            painting_id: string;
          };
          finish({
            matchId: r.id,
            role: "a",
            paintingId: r.painting_id,
            opponentId: r.player_b,
            avatarOpponent: r.avatar_b,
            selfId,
          });
        },
      )
      .subscribe();

    // Safety net: poll periodically in case realtime lags or the INSERT
    // committed before the subscription attached.
    pollHandle = setInterval(async () => {
      if (done) return;
      const { data } = await supabase
        .from("matches")
        .select("id, player_b, avatar_b, painting_id")
        .eq("player_a", selfId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && !done) {
        finish({
          matchId: data.id,
          role: "a",
          paintingId: data.painting_id,
          opponentId: data.player_b,
          avatarOpponent: data.avatar_b,
          selfId,
        });
      }
    }, 1000);
  });
}

export async function cancelQueue() {
  try {
    await supabase.rpc("cancel_queue");
  } catch {
    /* ignore */
  }
}

export async function markLeft(matchId: string, role: "a" | "b") {
  const patch = role === "a" ? { a_left: true } : { b_left: true };
  try {
    await supabase.from("matches").update(patch).eq("id", matchId);
  } catch {
    /* ignore */
  }
}

export async function submitReady(
  matchId: string,
  role: "a" | "b",
  figures: SerializedFigure[],
) {
  const patch =
    role === "a"
      ? { a_ready: true, a_figures: figures as unknown as Json }
      : { b_ready: true, b_figures: figures as unknown as Json };
  const { error } = await supabase.from("matches").update(patch).eq("id", matchId);
  if (error) throw error;
}

export async function markFinding(
  matchId: string,
  role: "a" | "b",
  index: number,
  current: boolean[],
) {
  const next = current.slice();
  next[index] = true;
  // Opponent's `x_findings` array tracks how many of MY figures the opponent has found.
  // When we (as role) tap and find, we update the OPPONENT's findings on us? No —
  // In this schema: `a_findings` = the results of hunting FROM player A on player B.
  // So role "a" tapping a found figure updates a_findings; role "b" updates b_findings.
  const patch = role === "a" ? { a_findings: next } : { b_findings: next };
  await supabase.from("matches").update(patch).eq("id", matchId);
  return next;
}

export interface SerializedFigure {
  poseId: 0 | 1 | 2;
  x: number;
  y: number;
  rot: number;
  mirror: boolean;
  paint: string; // data URL
}

export async function setPhase(matchId: string, phase: "camouflage" | "hunt" | "ended") {
  await supabase.from("matches").update({ phase }).eq("id", matchId);
}