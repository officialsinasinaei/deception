import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { POSES, FIGURE_W, FIGURE_H, posePath2D, type FigurePose } from "@/game/figures";
import { PAINTINGS, randomPainting, type Painting } from "@/game/paintings";
import { loadImage, samplePalette, camouflageQuality } from "@/game/engine";
import { sfx } from "@/game/audio";
import { avatarFor } from "@/game/avatars";
import { useEconomy } from "@/game/store";
import { supabase } from "@/integrations/supabase/client";
import {
  markFinding,
  markLeft,
  setPhase as setMatchPhase,
  submitReady,
  type SerializedFigure,
} from "@/game/matchmaking";

const searchSchema = z.object({
  matchId: z.string().uuid().optional(),
  role: z.enum(["a", "b"]).optional(),
  mode: z.enum(["bot"]).optional(),
  painting: z.string().optional(),
});

export const Route = createFileRoute("/play")({
  validateSearch: (s) => searchSchema.parse(s),
  component: PlayPage,
});

interface FigureState {
  pose: FigurePose;
  x: number;
  y: number; // center on canvas
  rot: number; // radians
  mirror: boolean;
  paint: HTMLCanvasElement; // offscreen paint layer, size FIGURE_W x FIGURE_H
  found: boolean; // player-side: bot has found this figure
}

// Canvas dimensions — the "master painting" logical size.
const CW = 900;
const CH = 1200; // 3:4 portrait

type Phase = "loading" | "camouflage" | "hunt" | "ended";

function PlayPage() {
  const nav = useNavigate();
  const search = Route.useSearch();
  const isPvP = !!search.matchId && !!search.role;
  const matchId = search.matchId;
  const role = search.role;
  const [phase, setPhase] = useState<Phase>("loading");
  const [timer, setTimer] = useState(60);
  const [painting, setPainting] = useState<Painting | null>(null);
  const [bgCanvas, setBgCanvas] = useState<HTMLCanvasElement | null>(null);
  const [botBgCanvas, setBotBgCanvas] = useState<HTMLCanvasElement | null>(null); // same painting, but we duplicate for isolation
  const [playerFigures, setPlayerFigures] = useState<FigureState[]>([]);
  const [botFigures, setBotFigures] = useState<FigureState[]>([]);
  const [foundBotCount, setFoundBotCount] = useState(0);
  const [misses, setMisses] = useState(0);
  const [ended, setEnded] = useState<"win" | "loss" | null>(null);
  const endedRef = useRef<"win" | "loss" | null>(null);
  useEffect(() => {
    endedRef.current = ended;
  }, [ended]);
  const [awaitingOpp, setAwaitingOpp] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const paintingRef = useRef<Painting | null>(null);
  const submittedRef = useRef(false);
  const opponentLoadedRef = useRef(false);

  // Init painting + figures
  useEffect(() => {
    let mounted = true;
    (async () => {
      const p =
        (search.painting && PAINTINGS.find((x) => x.id === search.painting)) || randomPainting();
      paintingRef.current = p;
      setPainting(p);
      try {
        const img = await loadImage(p.url);
        if (!mounted) return;
        const bg = document.createElement("canvas");
        bg.width = CW;
        bg.height = CH;
        const ctx = bg.getContext("2d")!;
        // cover fit
        const scale = Math.max(CW / img.width, CH / img.height);
        const dw = img.width * scale,
          dh = img.height * scale;
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, CW, CH);
        ctx.drawImage(img, (CW - dw) / 2, (CH - dh) / 2, dw, dh);
        const botBg = document.createElement("canvas");
        botBg.width = CW;
        botBg.height = CH;
        botBg.getContext("2d")!.drawImage(bg, 0, 0);
        setBgCanvas(bg);
        setBotBgCanvas(botBg);

        // Initial figure placements: distributed near center
        const spots = [
          { x: CW * 0.3, y: CH * 0.4 },
          { x: CW * 0.6, y: CH * 0.55 },
          { x: CW * 0.4, y: CH * 0.75 },
        ];
        const pfs: FigureState[] = POSES.map((pose, i) => ({
          pose,
          x: spots[i].x,
          y: spots[i].y,
          rot: 0,
          mirror: false,
          paint: makePaintLayer(),
          found: false,
        }));
        setPlayerFigures(pfs);

        // Bot figures: pre-placed & pre-painted (solo/bot mode only). In PvP
        // we wait for the opponent's Ready payload before the hunt begins.
        if (!isPvP) {
          const bfs = generateBotFigures(bg);
          setBotFigures(bfs);
        }

        setPhase("camouflage");
      } catch (e) {
        console.error(e);
        if (mounted) setLoadError("Failed to load painting. Please try again.");
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Camouflage countdown
  useEffect(() => {
    if (phase !== "camouflage") return;
    if (timer <= 0) {
      toHunt();
      return;
    }
    const t = setTimeout(() => setTimer((v) => v - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timer]);

  const toHunt = useCallback(async () => {
    if (!isPvP) {
      setPhase("hunt");
      sfx.snap();
      return;
    }
    if (submittedRef.current) return;
    submittedRef.current = true;
    setAwaitingOpp(true);
    try {
      const serialized: SerializedFigure[] = playerFigures.map((f) => ({
        poseId: f.pose.id,
        x: f.x,
        y: f.y,
        rot: f.rot,
        mirror: f.mirror,
        paint: f.paint.toDataURL("image/png"),
      }));
      await submitReady(matchId!, role!, serialized);
      // If opponent already submitted before us, transition immediately.
      if (opponentLoadedRef.current) {
        setAwaitingOpp(false);
        setPhase("hunt");
        sfx.snap();
      }
    } catch (e) {
      console.error("submitReady failed", e);
      submittedRef.current = false;
      setAwaitingOpp(false);
    }
  }, [isPvP, matchId, role, playerFigures]);

  // Bot hunter logic — schedule find events during hunt (bot / solo only)
  useEffect(() => {
    if (isPvP) return;
    if (phase !== "hunt" || ended) return;
    // Difficulty influenced by player's camouflage quality
    let sumQ = 0;
    if (bgCanvas) {
      playerFigures.forEach((f) => {
        sumQ += camouflageQuality(bgCanvas, f.paint, f.x - FIGURE_W / 2, f.y - FIGURE_H / 2);
      });
    }
    const avgQ = sumQ / Math.max(1, playerFigures.length);
    // Each find takes 20–30s (scaled up by good camouflage), scheduled
    // sequentially so consecutive finds are never bunched together.
    const timers: ReturnType<typeof setTimeout>[] = [];
    let cumulative = 0;
    playerFigures.forEach((_, idx) => {
      const perFind = (20 + Math.random() * 10) * 1000 * (0.8 + avgQ * 1.6);
      cumulative += perFind;
      const t = setTimeout(() => {
        setPlayerFigures((prev) => {
          if (!prev[idx] || prev[idx].found) return prev;
          const next = prev.slice();
          next[idx] = { ...next[idx], found: true };
          sfx.alarm();
          triggerShake();
          triggerMinimapFlash(idx);
          const foundCount = next.filter((f) => f.found).length;
          if (foundCount >= 3) {
            setEnded("loss");
          }
          return next;
        });
      }, cumulative);
      timers.push(t);
    });
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ended, bgCanvas, isPvP]);

  // ---------- PvP realtime sync ----------
  const myFindsRef = useRef<boolean[]>([false, false, false]);
  useEffect(() => {
    if (!isPvP || !matchId || !role) return;
    let cancelled = false;

    const applyRow = async (row: MatchRow) => {
      if (cancelled) return;
      const oppReady = role === "a" ? row.b_ready : row.a_ready;
      const oppLeft = role === "a" ? row.b_left : row.a_left;
      const oppFigsBlob = role === "a" ? row.b_figures : row.a_figures;
      const oppFindings = (role === "a" ? row.b_findings : row.a_findings) as boolean[] | null;
      const myFindings = (role === "a" ? row.a_findings : row.b_findings) as boolean[] | null;

      // Opponent abandoned mid-match → immediate win.
      if (oppLeft && !endedRef.current) {
        setEnded("win");
        void setMatchPhase(matchId, "ended").catch(() => {});
        return;
      }

      // Opponent's finds against us → update playerFigures.found & possibly loss.
      if (oppFindings) {
        setPlayerFigures((prev) => {
          if (!prev.length) return prev;
          let mutated = false;
          const next = prev.map((f, i) => {
            if (oppFindings[i] && !f.found) {
              mutated = true;
              return { ...f, found: true };
            }
            return f;
          });
          if (mutated) {
            sfx.alarm();
            triggerShake();
            const foundCount = next.filter((f) => f.found).length;
            if (foundCount >= 3 && !endedRef.current) setEnded("loss");
          }
          return mutated ? next : prev;
        });
      }

      // My own finds (in case UI missed a state) — mirror foundBotCount.
      // Reconcile UP only (a stale echo must never downgrade the live count).
      if (myFindings) {
        myFindsRef.current = myFindings;
        const found = myFindings.filter(Boolean).length;
        setFoundBotCount((prev) => Math.max(prev, found));
      }

      // Enter hunt when opponent's figures arrive.
      if (oppReady && oppFigsBlob && !opponentLoadedRef.current) {
        opponentLoadedRef.current = true;
        const bfs = await deserializeOpponentFigures(oppFigsBlob as unknown as SerializedFigure[]);
        if (cancelled) return;
        setBotFigures(bfs);
        setAwaitingOpp(false);
        if (submittedRef.current) {
          setPhase("hunt");
          sfx.snap();
        }
      }

      // If DB says match ended and a winner is known, respect it.
      if (row.phase === "ended" && row.winner && !endedRef.current) {
        setEnded(
          row.winner === row.player_a
            ? role === "a"
              ? "win"
              : "loss"
            : role === "b"
              ? "win"
              : "loss",
        );
      }
    };

    // Initial fetch
    (async () => {
      const { data } = await supabase.from("matches").select("*").eq("id", matchId).maybeSingle();
      if (data) applyRow(data as unknown as MatchRow);
    })();

    const channel = supabase
      .channel(`match:${matchId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        (payload) => applyRow(payload.new as unknown as MatchRow),
      )
      .subscribe();

    // Announce leave on unload / navigation
    const onLeave = () => {
      void markLeft(matchId, role);
    };
    window.addEventListener("beforeunload", onLeave);

    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", onLeave);
      supabase.removeChannel(channel);
      if (!endedRef.current) void markLeft(matchId, role);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPvP, matchId, role]);

  // Navigate on end
  useEffect(() => {
    if (!ended) return;
    const accuracy = Math.max(0, 100 - misses * 8);
    if (isPvP && matchId && role) {
      // Broadcast result to the peer.
      void (async () => {
        try {
          if (ended === "win") {
            const { data } = await supabase
              .from("matches")
              .select("player_a,player_b")
              .eq("id", matchId)
              .maybeSingle();
            const winner = data ? (role === "a" ? data.player_a : data.player_b) : null;
            if (winner)
              await supabase.from("matches").update({ winner, phase: "ended" }).eq("id", matchId);
          } else {
            await setMatchPhase(matchId, "ended");
          }
        } catch {
          /* ignore */
        }
      })();
    }
    const t = setTimeout(() => {
      nav({ to: "/result", search: { outcome: ended, accuracy } });
    }, 1600);
    return () => clearTimeout(t);
  }, [ended, misses, nav, isPvP, matchId, role]);

  const [shaking, setShaking] = useState(false);
  const [flashIdx, setFlashIdx] = useState<number | null>(null);
  const triggerShake = () => setShaking(true);
  const triggerMinimapFlash = (i: number) => {
    setFlashIdx(i);
    setTimeout(() => setFlashIdx(null), 1300);
  };

  if (phase === "loading" || !painting || !bgCanvas) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          {loadError ? (
            <>
              <div className="font-display text-2xl italic text-destructive-foreground">
                {loadError}
              </div>
              <button
                onClick={() => nav({ to: "/" })}
                className="mt-4 px-6 py-3 border border-[var(--gold)]/40 text-[var(--gold)]/80 uppercase tracking-widest text-xs"
              >
                Return to Gallery
              </button>
            </>
          ) : (
            <>
              <div className="font-display text-2xl italic text-[var(--gold)]">
                Preparing canvas…
              </div>
              <div className="mt-2 text-xs text-muted-foreground uppercase tracking-widest">
                {painting?.title ?? ""}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const onFound = (i: number) => {
    if (isPvP && myFindsRef.current[i]) return; // Already reported
    setBotFigures((prev) => {
      if (!prev[i] || prev[i].found) return prev;
      const next = prev.slice();
      next[i] = { ...next[i], found: true };
      sfx.shatter();
      const found = next.filter((f) => f.found).length;
      setFoundBotCount(found);
      if (found >= 3) setEnded("win");
      return next;
    });
    if (isPvP && matchId && role) {
      const nextFinds = myFindsRef.current.slice();
      nextFinds[i] = true;
      myFindsRef.current = nextFinds;
      void markFinding(matchId, role, i, myFindsRef.current);
    }
  };

  return (
    <div
      className="min-h-[100dvh] bg-background text-foreground flex flex-col"
      style={shaking ? { animation: "shake 0.5s" } : undefined}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setShaking(false);
      }}
    >
      <PhaseBar
        phase={phase}
        timer={timer}
        painting={painting}
        found={foundBotCount}
        onReady={toHunt}
      />

      <div className="flex-1 flex flex-col min-h-0">
        {phase === "camouflage" ? (
          <CamouflageView bg={bgCanvas!} figures={playerFigures} setFigures={setPlayerFigures} />
        ) : (
          <HuntView
            botBg={botBgCanvas!}
            botFigures={botFigures}
            onFound={onFound}
            missed={() => {
              setMisses((m) => m + 1);
              sfx.penalty();
            }}
            playerFigures={playerFigures}
            flashIdx={flashIdx}
          />
        )}
      </div>

      {awaitingOpp && phase === "camouflage" && (
        <div className="absolute inset-0 bg-background/85 backdrop-blur-sm grid place-items-center">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-[0.4em] text-[var(--gold)]/70">
              Ready
            </div>
            <div className="font-display text-3xl italic mt-2 text-[var(--ivory)]">
              Awaiting rival…
            </div>
            <div className="mt-4 w-8 h-8 mx-auto rounded-full border border-[var(--gold)]/60 border-t-transparent animate-spin" />
          </div>
        </div>
      )}

      {ended && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm grid place-items-center">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-[0.4em] text-[var(--gold)]/70">
              Match Ended
            </div>
            <div
              className={`font-display text-5xl italic mt-2 ${ended === "win" ? "text-[var(--gold)]" : "text-destructive-foreground/70"}`}
            >
              {ended === "win" ? "Victoria" : "Sconfitta"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- PvP helpers ----------

interface MatchRow {
  id: string;
  player_a: string;
  player_b: string;
  avatar_a: number;
  avatar_b: number;
  painting_id: string;
  phase: "camouflage" | "hunt" | "ended";
  a_figures: unknown;
  b_figures: unknown;
  a_findings: unknown;
  b_findings: unknown;
  a_ready: boolean;
  b_ready: boolean;
  a_left: boolean;
  b_left: boolean;
  winner: string | null;
}

async function deserializeOpponentFigures(blob: SerializedFigure[]): Promise<FigureState[]> {
  const out: FigureState[] = [];
  for (const s of blob) {
    const pose = POSES.find((p) => p.id === s.poseId) ?? POSES[0];
    const paint = makePaintLayer();
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        paint.getContext("2d")!.drawImage(img, 0, 0);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = s.paint;
    });
    out.push({ pose, x: s.x, y: s.y, rot: s.rot, mirror: s.mirror, paint, found: false });
  }
  return out;
}

function makePaintLayer() {
  const c = document.createElement("canvas");
  c.width = FIGURE_W;
  c.height = FIGURE_H;
  return c;
}

function generateBotFigures(bg: HTMLCanvasElement): FigureState[] {
  // Curated hotspots
  const hotspots = [
    { x: CW * 0.2, y: CH * 0.3 },
    { x: CW * 0.75, y: CH * 0.35 },
    { x: CW * 0.5, y: CH * 0.7 },
    { x: CW * 0.25, y: CH * 0.75 },
    { x: CW * 0.65, y: CH * 0.85 },
  ];
  const chosen = [...hotspots].sort(() => Math.random() - 0.5).slice(0, 3);
  return POSES.map((pose, i) => {
    const paint = makePaintLayer();
    // Auto-camouflage: sample background beneath, fill mask with sampled colors mottled
    const spot = chosen[i];
    const bx = spot.x - FIGURE_W / 2;
    const by = spot.y - FIGURE_H / 2;
    const palette = samplePalette(bg, bx, by, FIGURE_W, FIGURE_H, 5);
    const dominant = averageColor(palette);
    const ctx = paint.getContext("2d")!;
    // Clip to mask
    ctx.save();
    const p = posePath2D(pose, FIGURE_W, FIGURE_H);
    ctx.translate(FIGURE_W / 2, FIGURE_H / 2);
    ctx.clip(p);
    ctx.translate(-FIGURE_W / 2, -FIGURE_H / 2);
    // Bot paints in a single flat color matching the background beneath.
    ctx.fillStyle = dominant;
    ctx.fillRect(0, 0, FIGURE_W, FIGURE_H);
    ctx.restore();
    return {
      pose,
      x: spot.x,
      y: spot.y,
      rot: (Math.random() - 0.5) * 0.3,
      mirror: Math.random() < 0.5,
      paint,
      found: false,
    };
  });
}

function averageColor(palette: string[]): string {
  if (palette.length === 0) return "#8a7a5c";
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (const hex of palette) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) continue;
    r += parseInt(m[1], 16);
    g += parseInt(m[2], 16);
    b += parseInt(m[3], 16);
    n++;
  }
  if (!n) return palette[0];
  const to = (v: number) =>
    Math.round(v / n)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function PhaseBar({
  phase,
  timer,
  painting,
  found,
  onReady,
}: {
  phase: Phase;
  timer: number;
  painting: Painting;
  found: number;
  onReady: () => void;
}) {
  const eco = useEconomy();
  const av = avatarFor(eco.selectedAvatar);
  return (
    <div className="px-4 py-2 border-b border-[var(--gold)]/20 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {av && (
          <div className="w-8 h-8 rounded-full border border-[var(--gold)]/60 overflow-hidden shrink-0">
            <img
              src={av.url}
              alt={av.name}
              className="w-full h-full object-cover"
              width={64}
              height={64}
            />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.3em] text-[var(--gold)]/70">
            {phase === "camouflage" ? "Camouflage" : "The Hunt"}
          </div>
          <div className="text-xs text-muted-foreground truncate italic">{painting.title}</div>
        </div>
      </div>
      {phase === "camouflage" ? (
        <div className="flex items-center gap-2 shrink-0">
          <div className="font-display text-2xl text-[var(--gold)] tabular-nums">
            {String(timer).padStart(2, "0")}
          </div>
          <button
            onClick={() => {
              sfx.ready();
              onReady();
            }}
            className="px-3 py-1.5 border-2 border-[var(--gold)] text-[var(--gold)] text-[10px] uppercase tracking-widest active:scale-95"
          >
            Ready
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`w-2.5 h-2.5 rotate-45 ${i < found ? "bg-[var(--gold)]" : "border border-[var(--gold)]/40"}`}
            />
          ))}
          <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            Found {found}/3
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------- Camouflage view ---------- */

function CamouflageView({
  bg,
  figures,
  setFigures,
}: {
  bg: HTMLCanvasElement;
  figures: FigureState[];
  setFigures: React.Dispatch<React.SetStateAction<FigureState[]>>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState(0);
  const [painting, setPainting] = useState(false);
  const [palette, setPalette] = useState<string[]>([]);
  const [color, setColor] = useState<string>("#8b6f5e");
  const [brushSize, setBrushSize] = useState(6);
  const [tool, setTool] = useState<"pencil" | "fill">("pencil");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const undoStacks = useRef<ImageData[][]>([[], [], []]);
  const drawing = useRef<{ lastX: number; lastY: number } | null>(null);

  // Fit canvas to viewport
  const [viewSize, setViewSize] = useState({ w: 360, h: 480 });
  useEffect(() => {
    const compute = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setViewSize({ w: rect.width, h: rect.height });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  // Base fit scale
  const baseScale = useMemo(() => Math.min(viewSize.w / CW, viewSize.h / CH), [viewSize]);

  // Redraw
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = viewSize.w * devicePixelRatio;
    c.height = viewSize.h * devicePixelRatio;
    c.style.width = viewSize.w + "px";
    c.style.height = viewSize.h + "px";
    const ctx = c.getContext("2d")!;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, viewSize.w, viewSize.h);
    ctx.save();
    // View transform
    const s = baseScale * zoom;
    const cx = viewSize.w / 2 + pan.x;
    const cy = viewSize.h / 2 + pan.y;
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-CW / 2, -CH / 2);
    // Background
    ctx.drawImage(bg, 0, 0);
    // Figures
    figures.forEach((f, i) => {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      if (f.mirror) ctx.scale(-1, 1);
      // Draw base white silhouette
      const p = posePath2D(f.pose, FIGURE_W, FIGURE_H);
      ctx.fillStyle = "#f2eee5";
      ctx.fill(p);
      // Draw paint layer over it (paint is already clipped to mask)
      ctx.drawImage(f.paint, -FIGURE_W / 2, -FIGURE_H / 2);
      // Selection outline
      if (i === selected) {
        ctx.strokeStyle = "oklch(0.78 0.13 82)";
        ctx.lineWidth = 1.5 / s;
        ctx.setLineDash([4 / s, 3 / s]);
        ctx.stroke(p);
        ctx.setLineDash([]);
      }
      ctx.restore();
    });
    ctx.restore();
  }, [figures, selected, viewSize, baseScale, zoom, pan, bg]);

  // Compute smart palette when selection changes
  useEffect(() => {
    const f = figures[selected];
    if (!f) return;
    const pal = samplePalette(bg, f.x - FIGURE_W / 2, f.y - FIGURE_H / 2, FIGURE_W, FIGURE_H, 5);
    setPalette(pal);
    if (pal[0]) setColor(pal[0]);
  }, [selected, bg, figures[selected]?.x, figures[selected]?.y]);

  // Pan the view to center the selected figure whenever selection changes
  // (or when entering painting mode). Without this, switching characters in
  // the top bar leaves the camera on the previously focused figure.
  useEffect(() => {
    const f = figures[selected];
    if (!f) return;
    if (painting) {
      const targetZoom = Math.min(3, viewSize.w / (FIGURE_W * baseScale * 1.4));
      setZoom(targetZoom);
      const s = baseScale * targetZoom;
      const px = (CW / 2 - f.x) * s;
      const py = (CH / 2 - f.y) * s + viewSize.h * 0.12;
      setPan({ x: px, y: py });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, viewSize.w, viewSize.h, baseScale, painting]);

  // Convert screen coords -> world coords
  const screenToWorld = (sx: number, sy: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const s = baseScale * zoom;
    const cx = viewSize.w / 2 + pan.x;
    const cy = viewSize.h / 2 + pan.y;
    const x = (sx - rect.left - cx) / s + CW / 2;
    const y = (sy - rect.top - cy) / s + CH / 2;
    return { x, y };
  };

  // Auto-zoom on paint activation
  const togglePaint = () => {
    const next = !painting;
    setPainting(next);
    sfx.click();
    if (next) {
      const f = figures[selected];
      if (!f) return;
      // Zoom to figure
      const targetZoom = Math.min(3, viewSize.w / (FIGURE_W * baseScale * 1.4));
      setZoom(targetZoom);
      const s = baseScale * targetZoom;
      // Pan so figure sits in top half of view (finger below)
      const px = (CW / 2 - f.x) * s;
      const py = (CH / 2 - f.y) * s + viewSize.h * 0.12;
      setPan({ x: px, y: py });
    } else {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  };

  // Interaction
  const dragState = useRef<{
    mode: "move" | "paint" | null;
    pointerId: number;
    startX: number;
    startY: number;
    origFig?: { x: number; y: number };
  } | null>(null);

  const pushUndo = (idx: number) => {
    const f = figures[idx];
    if (!f) return;
    const ctx = f.paint.getContext("2d")!;
    const snap = ctx.getImageData(0, 0, FIGURE_W, FIGURE_H);
    undoStacks.current[idx].push(snap);
    if (undoStacks.current[idx].length > 200) undoStacks.current[idx].shift();
  };

  const paintAt = (worldX: number, worldY: number, lastWX?: number, lastWY?: number) => {
    const f = figures[selected];
    if (!f) return;
    // Convert world -> figure-local (undo rotation/mirror)
    const toLocal = (wx: number, wy: number) => {
      const dx = wx - f.x,
        dy = wy - f.y;
      const cos = Math.cos(-f.rot),
        sin = Math.sin(-f.rot);
      let lx = dx * cos - dy * sin;
      let ly = dx * sin + dy * cos;
      if (f.mirror) lx = -lx;
      return { x: lx + FIGURE_W / 2, y: ly + FIGURE_H / 2 };
    };
    const cur = toLocal(worldX, worldY);
    const ctx = f.paint.getContext("2d")!;
    ctx.save();
    const p = posePath2D(f.pose, FIGURE_W, FIGURE_H);
    ctx.translate(FIGURE_W / 2, FIGURE_H / 2);
    ctx.clip(p);
    ctx.translate(-FIGURE_W / 2, -FIGURE_H / 2);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    if (lastWX !== undefined && lastWY !== undefined) {
      const last = toLocal(lastWX, lastWY);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Trigger rerender
    setFigures((prev) => prev.slice());
  };

  const fillFigure = (idx: number) => {
    const f = figures[idx];
    if (!f) return;
    pushUndo(idx);
    const ctx = f.paint.getContext("2d")!;
    ctx.save();
    // Replace any prior paint so the fill is a solid single color.
    ctx.clearRect(0, 0, FIGURE_W, FIGURE_H);
    const p = posePath2D(f.pose, FIGURE_W, FIGURE_H);
    ctx.translate(FIGURE_W / 2, FIGURE_H / 2);
    ctx.clip(p);
    ctx.translate(-FIGURE_W / 2, -FIGURE_H / 2);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, FIGURE_W, FIGURE_H);
    ctx.restore();
    setFigures((prev) => prev.slice());
    sfx.brush();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const w = screenToWorld(e.clientX, e.clientY);
    if (painting) {
      // Fill mode: tap the figure to flood it with the selected color.
      if (tool === "fill") {
        const hit = hitFigure(figures, w.x, w.y);
        const target = hit >= 0 ? hit : selected;
        if (hit >= 0 && hit !== selected) setSelected(hit);
        fillFigure(target);
        return;
      }
      pushUndo(selected);
      drawing.current = { lastX: w.x, lastY: w.y };
      dragState.current = {
        mode: "paint",
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
      };
      sfx.pencil();
      paintAt(w.x, w.y);
    } else {
      // Select nearest figure OR move selected if tapping on it
      const hit = hitFigure(figures, w.x, w.y);
      if (hit >= 0) {
        setSelected(hit);
        sfx.brush();
        const f = figures[hit];
        dragState.current = {
          mode: "move",
          pointerId: e.pointerId,
          startX: w.x,
          startY: w.y,
          origFig: { x: f.x, y: f.y },
        };
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds) return;
    const w = screenToWorld(e.clientX, e.clientY);
    if (ds.mode === "paint" && drawing.current) {
      paintAt(w.x, w.y, drawing.current.lastX, drawing.current.lastY);
      drawing.current = { lastX: w.x, lastY: w.y };
    } else if (ds.mode === "move" && ds.origFig) {
      const dx = w.x - ds.startX,
        dy = w.y - ds.startY;
      setFigures((prev) => {
        const next = prev.slice();
        const f = next[selected];
        if (!f) return prev;
        next[selected] = { ...f, x: ds.origFig!.x + dx, y: ds.origFig!.y + dy };
        return next;
      });
    }
  };

  const onPointerUp = () => {
    dragState.current = null;
    drawing.current = null;
  };

  const rotate = (delta: number) => {
    setFigures((prev) => {
      const next = prev.slice();
      const f = next[selected];
      if (!f) return prev;
      next[selected] = { ...f, rot: f.rot + delta };
      return next;
    });
    sfx.click();
  };
  const mirror = () => {
    setFigures((prev) => {
      const next = prev.slice();
      const f = next[selected];
      if (!f) return prev;
      next[selected] = { ...f, mirror: !f.mirror };
      return next;
    });
    sfx.click();
  };
  const undo = () => {
    const stack = undoStacks.current[selected];
    const snap = stack.pop();
    if (!snap) return;
    const f = figures[selected];
    const ctx = f.paint.getContext("2d")!;
    ctx.clearRect(0, 0, FIGURE_W, FIGURE_H);
    ctx.putImageData(snap, 0, 0);
    setFigures((prev) => prev.slice());
    sfx.brush();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Figure selectors */}
      <div className="px-4 py-2 flex items-center justify-between gap-2 border-b border-[var(--gold)]/10">
        <div className="flex gap-2">
          {figures.map((f, i) => (
            <button
              key={i}
              onClick={() => {
                setSelected(i);
                sfx.click();
              }}
              className={`w-10 h-10 border ${selected === i ? "border-[var(--gold)]" : "border-[var(--gold)]/30"} bg-[var(--secondary)] grid place-items-center`}
            >
              <FigureThumb pose={f.pose} />
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <IconBtn onClick={() => rotate(-Math.PI / 12)} label="↺" />
          <IconBtn onClick={() => rotate(Math.PI / 12)} label="↻" />
          <IconBtn onClick={mirror} label="⇋" />
        </div>
      </div>

      {/* Canvas */}
      <div ref={wrapRef} className="flex-1 min-h-0 relative overflow-hidden bg-[var(--ink-black)]">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="touch-none select-none"
        />
        {painting && (
          <div className="absolute top-2 left-2 right-2 pointer-events-none">
            <div className="inline-block text-[9px] uppercase tracking-widest text-[var(--gold)]/70 bg-background/60 px-2 py-1 rounded-sm pointer-events-auto">
              {tool === "fill"
                ? "Fill — tap figure to flood with color"
                : "Fine Pencil — draws only on figure"}
            </div>
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="border-t border-[var(--gold)]/20 bg-[var(--card)]">
        {painting && (
          <div className="px-3 py-2 flex items-center gap-2 border-b border-[var(--gold)]/10">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground shrink-0">
              Palette
            </span>
            <div className="flex gap-1.5 flex-1 overflow-x-auto">
              {palette.map((c, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setColor(c);
                    sfx.click();
                  }}
                  className={`w-8 h-8 rounded-sm shrink-0 border-2 ${color === c ? "border-[var(--gold)]" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => {
                  setTool("pencil");
                  sfx.click();
                }}
                className={`h-8 px-2 grid place-items-center border text-[10px] uppercase tracking-widest ${tool === "pencil" ? "border-[var(--gold)] text-[var(--gold)]" : "border-[var(--gold)]/20 text-[var(--gold)]/60"}`}
                aria-pressed={tool === "pencil"}
                title="Pencil"
              >
                ✎
              </button>
              <button
                onClick={() => {
                  setTool("fill");
                  sfx.click();
                }}
                className={`h-8 px-2 grid place-items-center border text-[10px] uppercase tracking-widest ${tool === "fill" ? "border-[var(--gold)] text-[var(--gold)]" : "border-[var(--gold)]/20 text-[var(--gold)]/60"}`}
                aria-pressed={tool === "fill"}
                title="Fill"
              >
                🪣
              </button>
            </div>
            <div
              className={`flex gap-1 shrink-0 ${tool === "fill" ? "opacity-40 pointer-events-none" : ""}`}
            >
              {[3, 6, 12].map((s) => (
                <button
                  key={s}
                  onClick={() => setBrushSize(s)}
                  className={`w-8 h-8 grid place-items-center border ${brushSize === s ? "border-[var(--gold)]" : "border-[var(--gold)]/20"}`}
                >
                  <div className="rounded-full bg-[var(--ivory)]" style={{ width: s, height: s }} />
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="px-3 py-2.5 flex items-center gap-2">
          <button
            onClick={togglePaint}
            className={`flex-1 py-2.5 border-2 uppercase tracking-widest text-[11px] ${painting ? "border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)]" : "border-[var(--gold)]/50 text-[var(--gold)]/90"}`}
          >
            {painting ? "✎ Painting" : "✎ Fine Pencil"}
          </button>
          <button
            onClick={undo}
            className="py-2.5 px-4 border border-[var(--gold)]/40 text-[var(--gold)]/80 uppercase tracking-widest text-[11px]"
          >
            ↩ Undo
          </button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="w-10 h-10 border border-[var(--gold)]/40 text-[var(--gold)] grid place-items-center text-lg active:scale-95"
    >
      {label}
    </button>
  );
}

function FigureThumb({ pose }: { pose: FigurePose }) {
  return (
    <svg viewBox="0 0 100 200" className="w-5 h-8">
      <path d={pose.path} fill="var(--ivory)" />
    </svg>
  );
}

function hitFigure(figs: FigureState[], wx: number, wy: number): number {
  // Rough AABB with rotation ignored (good enough for selection)
  for (let i = 0; i < figs.length; i++) {
    const f = figs[i];
    if (Math.abs(wx - f.x) < FIGURE_W / 2 && Math.abs(wy - f.y) < FIGURE_H / 2) return i;
  }
  return -1;
}

/* ---------- Hunt view ---------- */

function HuntView({
  botBg,
  botFigures,
  onFound,
  missed,
  playerFigures,
  flashIdx,
}: {
  botBg: HTMLCanvasElement;
  botFigures: FigureState[];
  onFound: (i: number) => void;
  missed: () => void;
  playerFigures: FigureState[];
  flashIdx: number | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [viewSize, setViewSize] = useState({ w: 360, h: 480 });
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const compute = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setViewSize({ w: r.width, h: r.height });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  const baseScale = useMemo(() => Math.min(viewSize.w / CW, viewSize.h / CH), [viewSize]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = viewSize.w * devicePixelRatio;
    c.height = viewSize.h * devicePixelRatio;
    c.style.width = viewSize.w + "px";
    c.style.height = viewSize.h + "px";
    const ctx = c.getContext("2d")!;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, viewSize.w, viewSize.h);
    ctx.save();
    const s = baseScale * zoom;
    const cx = viewSize.w / 2 + pan.x;
    const cy = viewSize.h / 2 + pan.y;
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-CW / 2, -CH / 2);
    ctx.drawImage(botBg, 0, 0);
    // Draw bot figures (painted only — not the white silhouette, that's what makes it hard!)
    botFigures.forEach((f) => {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      if (f.mirror) ctx.scale(-1, 1);
      if (!f.found) {
        ctx.drawImage(f.paint, -FIGURE_W / 2, -FIGURE_H / 2);
      }
      ctx.restore();
    });
    ctx.restore();
  }, [botBg, botFigures, viewSize, baseScale, zoom, pan]);

  // Gestures: pinch to zoom, drag to pan, tap to hunt
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gesture = useRef<{
    mode: "none" | "pan" | "pinch" | "tap";
    startPan: { x: number; y: number };
    startZoom: number;
    startDist: number;
    startX: number;
    startY: number;
    downTime: number;
  } | null>(null);

  const screenToWorld = (sx: number, sy: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const s = baseScale * zoom;
    const cx = viewSize.w / 2 + pan.x;
    const cy = viewSize.h / 2 + pan.y;
    return {
      x: (sx - rect.left - cx) / s + CW / 2,
      y: (sy - rect.top - cy) / s + CH / 2,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (locked) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gesture.current = {
        mode: "tap",
        startPan: { ...pan },
        startZoom: zoom,
        startDist: 0,
        startX: e.clientX,
        startY: e.clientY,
        downTime: Date.now(),
      };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        mode: "pinch",
        startPan: { ...pan },
        startZoom: zoom,
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startX: 0,
        startY: 0,
        downTime: Date.now(),
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.mode === "tap") {
      const dx = e.clientX - g.startX,
        dy = e.clientY - g.startY;
      if (Math.hypot(dx, dy) > 8) {
        gesture.current = { ...g, mode: "pan" };
      }
    } else if (g.mode === "pan") {
      const dx = e.clientX - g.startX,
        dy = e.clientY - g.startY;
      setPan({ x: g.startPan.x + dx, y: g.startPan.y + dy });
    } else if (g.mode === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const nz = Math.max(0.8, Math.min(4, g.startZoom * (dist / g.startDist)));
      setZoom(nz);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (g && g.mode === "tap" && Date.now() - g.downTime < 400) {
      // Actual tap — hit test
      const w = screenToWorld(e.clientX, e.clientY);
      const hit = hitBotFigure(botFigures, w.x, w.y);
      if (hit >= 0) {
        onFound(hit);
      } else {
        missed();
        setLocked(true);
        setTimeout(() => setLocked(false), 2000);
      }
    }
    if (pointers.current.size === 0) gesture.current = null;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Opponent canvas — 80% */}
      <div
        ref={wrapRef}
        className="relative flex-[8] min-h-0 overflow-hidden bg-[var(--ink-black)]"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="touch-none select-none"
        />
        <div className="absolute top-2 left-2 pointer-events-none">
          <div className="text-[9px] uppercase tracking-widest text-[var(--gold)]/70 bg-background/60 px-2 py-1">
            Opponent's canvas · pinch, drag, tap
          </div>
        </div>
        {locked && (
          <div className="absolute inset-0 grid place-items-center bg-destructive/20 backdrop-blur-[2px]">
            <div className="text-destructive-foreground font-display text-2xl italic">Missed</div>
          </div>
        )}
      </div>

      {/* Mini-map — 20% */}
      <div className="flex-[2] min-h-0 border-t border-[var(--gold)]/30 bg-[var(--card)] flex items-center gap-3 px-4">
        <div className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground shrink-0 w-14">
          Your figures
        </div>
        <div className="flex-1 flex items-center justify-around gap-2 py-2">
          {playerFigures.map((f, i) => (
            <div
              key={i}
              className={`relative border ${f.found ? "border-destructive" : "border-[var(--gold)]/30"} p-1 ${flashIdx === i ? "redflash" : ""} ${f.found ? "opacity-60" : ""}`}
              style={{ width: 52, height: 78 }}
            >
              <MiniFigure fig={f} />
              {f.found && (
                <div className="absolute inset-0 grid place-items-center text-destructive text-xl">
                  ✕
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function hitBotFigure(figs: FigureState[], wx: number, wy: number): number {
  // Test in reverse (top-most first) using rotated local coords + mask pixel test.
  for (let i = figs.length - 1; i >= 0; i--) {
    const f = figs[i];
    if (f.found) continue;
    const dx = wx - f.x,
      dy = wy - f.y;
    const cos = Math.cos(-f.rot),
      sin = Math.sin(-f.rot);
    let lx = dx * cos - dy * sin;
    let ly = dx * sin + dy * cos;
    if (f.mirror) lx = -lx;
    const px = lx + FIGURE_W / 2;
    const py = ly + FIGURE_H / 2;
    if (px < 0 || py < 0 || px >= FIGURE_W || py >= FIGURE_H) continue;
    const ctx = f.paint.getContext("2d")!;
    try {
      const d = ctx.getImageData(Math.floor(px), Math.floor(py), 1, 1).data;
      if (d[3] > 32) return i;
    } catch {
      /* CORS or bounds */
    }
  }
  return -1;
}

function MiniFigure({ fig }: { fig: FigureState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = FIGURE_W;
    c.height = FIGURE_H;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, FIGURE_W, FIGURE_H);
    // Draw pose silhouette in white so figures are visible on the dark minimap
    ctx.save();
    ctx.translate(FIGURE_W / 2, FIGURE_H / 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill(posePath2D(fig.pose));
    ctx.restore();
    // Overlay the player's paint on top
    ctx.drawImage(fig.paint, 0, 0);
  }, [fig]);
  return <canvas ref={ref} className="w-full h-full block" />;
}
