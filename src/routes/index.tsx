import { createFileRoute } from "@tanstack/react-router";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEconomy, canStartMatch, INK_MAX, nextInkRegenMs } from "@/game/store";
import { sfx, startMusic, isMuted, toggleMuted, subscribeMuted, stopMusic } from "@/game/audio";
import { avatarFor } from "@/game/avatars";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DAILY_CYCLE_MS } from "@/game/store";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const eco = useEconomy();
  const nav = useNavigate();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Kick off ambient music on the first user gesture anywhere (AudioContext
  // needs one). We listen once here so returning to the gallery resumes it.
  useEffect(() => {
    const kick = () => { startMusic(); window.removeEventListener("pointerdown", kick); };
    window.addEventListener("pointerdown", kick, { once: true });
    return () => window.removeEventListener("pointerdown", kick);
  }, []);
  const canPlay = canStartMatch();
  const regenMs = nextInkRegenMs();
  const mm = Math.floor(regenMs / 60000);
  const ss = Math.floor((regenMs % 60000) / 1000);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <TopHUD ink={eco.ink} coins={eco.coins} avatar={eco.selectedAvatar} />

      <main className="flex-1 flex flex-col items-center justify-center px-6 gap-8 pb-8">
        <header className="text-center mt-4">
          <p className="text-[10px] uppercase tracking-[0.4em] text-[var(--gold)]/70">Gallery No. VII</p>
          <h1 className="font-display text-5xl leading-none mt-3 text-[var(--ivory)]">
            Canvas
            <br />
            <span className="italic text-[var(--gold)]">of Deception</span>
          </h1>
          <div className="mt-4 h-px w-24 mx-auto bg-[var(--gold)]/50" />
          <p className="mt-4 text-xs text-muted-foreground max-w-[240px] mx-auto leading-relaxed">
            Camouflage three figures into a Renaissance masterpiece. Hunt your opponent's before they find yours.
          </p>
        </header>

        <button
          onClick={() => { sfx.click(); if (canPlay) nav({ to: "/match" }); }}
          disabled={!canPlay}
          className="gold-pulse disabled:opacity-40 disabled:animate-none group relative w-56 h-56 rounded-full border-2 border-[var(--gold)] flex flex-col items-center justify-center transition-transform active:scale-95"
        >
          <span className="font-display text-3xl text-[var(--gold)]">Begin</span>
          <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mt-1">Enter Gallery</span>
          <span className="mt-3 text-[10px] text-muted-foreground">−1 coin · −1 ink on loss</span>
        </button>

        {!canPlay && (
          <p className="text-xs text-destructive-foreground/80 text-center">
            {eco.ink < 1 ? `Out of ink. Next drop in ${mm}:${String(ss).padStart(2, "0")}` : "Insufficient coins."}
          </p>
        )}

        <nav className="flex gap-3 text-xs uppercase tracking-widest">
          <Link to="/shop" onClick={() => sfx.click()} className="px-4 py-2 border border-[var(--gold)]/40 text-[var(--gold)]/90 hover:bg-[var(--gold)]/10">
            Atelier
          </Link>
          <Link to="/shop" search={{ tab: "chest" as const }} onClick={() => sfx.click()} className="px-4 py-2 border border-[var(--gold)]/40 text-[var(--gold)]/90 hover:bg-[var(--gold)]/10">
            Chest
          </Link>
        </nav>
      </main>

      <footer className="text-center pb-6 text-[10px] tracking-[0.3em] uppercase text-muted-foreground">
        {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Silent Gallery
      </footer>
    </div>
  );
}

export function TopHUD({ ink, coins, avatar }: { ink: number; coins: number; avatar: number }) {
  const eco = useEconomy();
  const now = Date.now();
  const streakActive = eco.dailyWinCycleStart > 0 && now - eco.dailyWinCycleStart < DAILY_CYCLE_MS;
  const streak = streakActive ? eco.dailyWins : 0;
  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--gold)]/20">
      <div className="flex items-center gap-2">
        <AvatarBadge id={avatar} />
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Painter</div>
      </div>
      <div className="flex items-center gap-4">
        <Stat label="Streak" value={`${streak}`} icon="✦" />
        <Stat label="Ink" value={`${ink}/${INK_MAX}`} icon="◈" />
        <Stat label="Coin" value={String(coins)} icon="◉" />
        <MuteButton />
      </div>
    </div>
  );
}

export function MuteButton() {
  const m = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  return (
    <button
      onClick={() => {
        const nowMuted = toggleMuted();
        if (nowMuted) stopMusic(); else { startMusic(); sfx.click(); }
      }}
      aria-label={m ? "Unmute audio" : "Mute audio"}
      title={m ? "Unmute" : "Mute"}
      className="w-8 h-8 grid place-items-center rounded-full border border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/10 text-sm leading-none"
    >
      {m ? "🔇" : "🔊"}
    </button>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[var(--gold)] text-lg leading-none">{icon}</span>
      <div className="leading-tight">
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="text-sm text-[var(--ivory)] font-medium tabular-nums">{value}</div>
      </div>
    </div>
  );
}

export function AvatarBadge({ id }: { id: number }) {
  const av = avatarFor(id);
  if (av) {
    return (
      <div className="w-9 h-9 rounded-full border border-[var(--gold)]/60 overflow-hidden bg-[var(--ink-black)]">
        <img src={av.url} alt={av.name} loading="lazy" width={72} height={72} className="w-full h-full object-cover" />
      </div>
    );
  }
  const hue = (id * 47) % 360;
  return (
    <div
      className="w-9 h-9 rounded-full border border-[var(--gold)]/60 grid place-items-center"
      style={{ background: `conic-gradient(from 0deg, oklch(0.4 0.1 ${hue}), oklch(0.25 0.08 ${(hue + 60) % 360}), oklch(0.4 0.1 ${hue}))` }}
    >
      <span className="font-display text-sm text-[var(--ivory)]">{String.fromCharCode(65 + id)}</span>
    </div>
  );
}
