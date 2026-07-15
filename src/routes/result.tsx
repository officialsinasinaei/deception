import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useRef } from "react";
import { rewardWin, penaltyLoss, useEconomy, WIN_COINS, DAILY_WINS_FOR_CHEST } from "@/game/store";
import { sfx } from "@/game/audio";
import { TopHUD } from "./index";

const searchSchema = z.object({
  outcome: z.enum(["win", "loss", "draw"]),
  accuracy: z.coerce.number().min(0).max(100).optional(),
});

export const Route = createFileRoute("/result")({
  validateSearch: (s) => searchSchema.parse(s),
  component: ResultPage,
});

function ResultPage() {
  const { outcome, accuracy = 100 } = Route.useSearch();
  const eco = useEconomy();
  const nav = useNavigate();
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    if (outcome === "win") {
      rewardWin();
      sfx.victory();
    } else if (outcome === "loss") {
      penaltyLoss();
      sfx.defeat();
    }
  }, [outcome]);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col">
      <TopHUD ink={eco.ink} coins={eco.coins} avatar={eco.selectedAvatar} />
      <main className="flex-1 flex flex-col items-center justify-center px-6 gap-6 text-center">
        <p className="text-[10px] uppercase tracking-[0.4em] text-[var(--gold)]/70">Verdict</p>
        <h1
          className={`font-display text-6xl italic ${outcome === "win" ? "text-[var(--gold)]" : outcome === "draw" ? "text-[var(--ivory)]" : "text-destructive-foreground/70"}`}
        >
          {outcome === "win" ? "Victoria" : outcome === "draw" ? "Patta" : "Sconfitta"}
        </h1>
        <div className="h-px w-24 bg-[var(--gold)]/40" />
        <p className="text-sm text-muted-foreground max-w-[260px]">
          {outcome === "win"
            ? "Your figures endured. You unmasked the rival's."
            : outcome === "draw"
              ? "Neither painter prevailed — a perfect stalemate."
              : "Your rival's eye was keener today. The gallery waits."}
        </p>

        <div className="grid grid-cols-2 gap-6 mt-2">
          <Stat label="Accuracy" value={`${Math.round(accuracy)}%`} />
          <Stat
            label={outcome === "draw" ? "Result" : outcome === "win" ? "Reward" : "Cost"}
            value={outcome === "win" ? `+${WIN_COINS} ◉` : outcome === "draw" ? "—" : "−1 ◉"}
          />
        </div>

        {outcome === "win" && (
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Daily wins {eco.dailyWins}/{DAILY_WINS_FOR_CHEST}
          </div>
        )}

        <div className="flex flex-col gap-3 mt-6 w-full max-w-xs">
          <button
            onClick={() => {
              sfx.click();
              nav({ to: "/match" });
            }}
            className="px-6 py-3 border-2 border-[var(--gold)] text-[var(--gold)] uppercase tracking-widest text-xs active:scale-95"
          >
            Another Match
          </button>
          <Link
            to="/"
            onClick={() => sfx.click()}
            className="px-6 py-3 border border-[var(--gold)]/30 text-muted-foreground uppercase tracking-widest text-xs text-center"
          >
            Return to Gallery
          </Link>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-display text-2xl mt-1 text-[var(--ivory)]">{value}</div>
    </div>
  );
}
