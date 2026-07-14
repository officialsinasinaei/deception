import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { canStartMatch, getEconomy, payEntry } from "@/game/store";
import { sfx } from "@/game/audio";
import { cancelQueue, findMatch } from "@/game/matchmaking";
import { PAINTINGS } from "@/game/paintings";

export const Route = createFileRoute("/match")({
  component: MatchmakingPage,
});

function MatchmakingPage() {
  const nav = useNavigate();
  const [phase, setPhase] = useState<"searching" | "found" | "error">("searching");
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!canStartMatch()) { nav({ to: "/" }); return; }

    const ctl = new AbortController();
    abortRef.current = ctl;
    const startedAt = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    // Give real PvP a chance to pair before falling back to a bot.
    const botTimer = setTimeout(() => playBot(), 10000);

    (async () => {
      try {
        const info = await findMatch({
          avatarId: getEconomy().selectedAvatar,
          signal: ctl.signal,
          timeoutMs: 60_000,
        });
        if (doneRef.current) return;
        doneRef.current = true;
        sfx.snap();
        setPhase("found");
        payEntry();
        setTimeout(() => {
          nav({
            to: "/play",
            search: { matchId: info.matchId, role: info.role, painting: info.paintingId },
          });
        }, 1000);
      } catch (e) {
        if (doneRef.current) return;
        if ((e as Error).message === "cancelled") return;
        console.error("matchmaking failed", e);
        // Silent fallback — bot timer will summon a rival.
      }
    })();

    return () => {
      clearInterval(tick);
      clearTimeout(botTimer);
      ctl.abort();
      if (!doneRef.current) void cancelQueue();
    };
  }, [nav]);

  function playBot() {
    if (doneRef.current) return;
    doneRef.current = true;
    abortRef.current?.abort();
    void cancelQueue();
    sfx.snap();
    setPhase("found");
    payEntry();
    const painting = PAINTINGS[Math.floor(Math.random() * PAINTINGS.length)].id;
    setTimeout(() => {
      nav({ to: "/play", search: { mode: "bot", painting } });
    }, 1000);
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <p className="text-[10px] uppercase tracking-[0.4em] text-[var(--gold)]/70">Matchmaking</p>
        <h1 className="font-display text-3xl italic mt-3 text-[var(--ivory)]">
          {phase === "searching"
            ? "Searching for opponents…"
            : "Rival found."}
        </h1>
        {phase === "searching" && (
          <p className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums">
            {elapsed.toString().padStart(2, "0")}s
          </p>
        )}
      </div>

      <div className="relative w-48 h-48">
        <div className="absolute inset-0 rounded-full border border-[var(--gold)]/30" />
        <div className="absolute inset-3 rounded-full border border-[var(--gold)]/20" />
        <div className="absolute inset-6 rounded-full border border-[var(--gold)]/10" />
        <div className="absolute inset-0 rounded-full animate-spin origin-center" style={{ animationDuration: "3s" }}>
          <div className="w-3 h-3 rounded-full bg-[var(--gold)] mx-auto -mt-1.5" />
        </div>
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-display text-6xl text-[var(--gold)]/70">
            {phase === "searching" ? "?" : "✦"}
          </span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground uppercase tracking-widest">
        {phase === "searching" ? "Pairing fastest" : "Preparing canvas"}
      </p>

      {phase === "searching" && elapsed >= 4 && (
        <p className="text-[10px] uppercase tracking-widest text-[var(--gold)]/60">
          Almost there…
        </p>
      )}
    </div>
  );
}