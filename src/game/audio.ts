// Canvas of Deception — richer Web Audio engine.
// Two buses: SFX (dry-ish w/ reverb send) + MUSIC (ambient baroque loop).
// All sounds are synthesized live; no asset downloads.

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let reverb: ConvolverNode | null = null;
let reverbSend: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;

// ---- Mute state (persisted) ----
const MUTE_KEY = "cod:muted:v1";
let muted = false;
const muteListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch {}
}
function applyMute() {
  if (masterGain) masterGain.gain.value = muted ? 0 : 0.9;
}
export function isMuted() { return muted; }
export function setMuted(v: boolean) {
  muted = v;
  try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); } catch {}
  applyMute();
  muteListeners.forEach((l) => l());
}
export function toggleMuted() { setMuted(!muted); return muted; }
export function subscribeMuted(l: () => void) { muteListeners.add(l); return () => muteListeners.delete(l); }

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new AC();
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 20;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.2;
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.9;
      compressor.connect(masterGain).connect(ctx.destination);
      applyMute();
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.9;
      sfxBus.connect(compressor);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.28;
      musicBus.connect(compressor);
      // Convolver reverb with a synthesized impulse (hall).
      reverb = ctx.createConvolver();
      reverb.buffer = makeImpulse(ctx, 2.6, 3.4);
      reverbSend = ctx.createGain();
      reverbSend.gain.value = 0.35;
      reverb.connect(reverbSend).connect(compressor);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function makeImpulse(a: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = a.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = a.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Slightly diffused, low-passed noise decay for a "gallery hall" tail.
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

/* ---------- Primitives ---------- */

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  attack?: number;
  release?: number;
  reverb?: number;      // 0..1 send
  bus?: GainNode | null;
  detune?: number;
  vibrato?: { rateHz: number; depthCents: number };
  filterHz?: number;    // low-pass cutoff
  filterQ?: number;
}

function tone(freq: number, dur: number, opts: ToneOpts = {}) {
  const a = ac();
  if (!a) return;
  const {
    type = "sine", gain = 0.15, delay = 0,
    attack = 0.008, release = dur,
    reverb: rvb = 0.15, bus = sfxBus, detune = 0,
    vibrato, filterHz, filterQ = 0.7,
  } = opts;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (detune) o.detune.setValueAtTime(detune, t0);
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(attack + 0.02, release));

  let node: AudioNode = o;
  if (filterHz) {
    const f = a.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filterHz;
    f.Q.value = filterQ;
    node.connect(f);
    node = f;
  }
  node.connect(g);

  if (vibrato) {
    const lfo = a.createOscillator();
    const lfoGain = a.createGain();
    lfo.frequency.value = vibrato.rateHz;
    lfoGain.gain.value = vibrato.depthCents;
    lfo.connect(lfoGain).connect(o.detune);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.05);
  }

  if (bus) g.connect(bus);
  if (reverb && reverbSend && rvb > 0) {
    const send = a.createGain();
    send.gain.value = rvb;
    g.connect(send).connect(reverb);
  }
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

// Plucked string (Karplus-Strong-ish via filtered noise burst + resonant tone).
function pluck(freq: number, dur: number, delay = 0, gain = 0.18, rvb = 0.35) {
  const a = ac();
  if (!a || !sfxBus) return;
  const t0 = a.currentTime + delay;
  // Body: two detuned sawtooths through a resonant lowpass with quick decay.
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const filt = a.createBiquadFilter();
  filt.type = "lowpass";
  filt.Q.value = 6;
  filt.frequency.setValueAtTime(freq * 8, t0);
  filt.frequency.exponentialRampToValueAtTime(freq * 2, t0 + dur);
  filt.connect(g).connect(sfxBus);
  if (reverb && reverbSend) {
    const s = a.createGain();
    s.gain.value = rvb;
    g.connect(s).connect(reverb);
  }
  for (let i = 0; i < 2; i++) {
    const o = a.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = i === 0 ? -6 : 6;
    o.connect(filt);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  // Attack noise burst.
  const nb = a.createBuffer(1, Math.floor(a.sampleRate * 0.03), a.sampleRate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
  const ns = a.createBufferSource();
  ns.buffer = nb;
  const ng = a.createGain();
  ng.gain.value = gain * 0.6;
  ns.connect(ng).connect(filt);
  ns.start(t0);
}

// Bowed cello — sawtooth pair through a body resonance + slow tremolo/vibrato.
function cello(freq: number, dur: number, delay = 0, gain = 0.14, detuneOff = 0) {
  const a = ac();
  if (!a || !sfxBus) return;
  const t0 = a.currentTime + delay;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.18);
  g.gain.setValueAtTime(gain, t0 + dur - 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const body = a.createBiquadFilter();
  body.type = "bandpass";
  body.frequency.value = freq * 3.2;
  body.Q.value = 2.5;
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = freq * 6;
  body.connect(lp).connect(g).connect(sfxBus);
  if (reverb && reverbSend) {
    const s = a.createGain();
    s.gain.value = 0.4;
    g.connect(s).connect(reverb);
  }
  const lfo = a.createOscillator();
  const lfoG = a.createGain();
  lfo.frequency.value = 5.2;
  lfoG.gain.value = 12;
  lfo.connect(lfoG);
  for (let i = 0; i < 2; i++) {
    const o = a.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = (i === 0 ? -8 : 8) + detuneOff;
    lfoG.connect(o.detune);
    o.connect(body);
    o.start(t0);
    o.stop(t0 + dur + 0.1);
  }
  lfo.start(t0);
  lfo.stop(t0 + dur + 0.1);
}

function noise(dur: number, gain = 0.15, delay = 0, filterHz = 2000, type: BiquadFilterType = "bandpass", q = 1) {
  const a = ac();
  if (!a || !sfxBus) return;
  const t0 = a.currentTime + delay;
  const bufLen = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, bufLen, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufLen);
  const src = a.createBufferSource();
  src.buffer = buf;
  const filt = a.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = filterHz;
  filt.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filt).connect(g).connect(sfxBus);
  src.start(t0);
}

/* ---------- SFX ---------- */

// D minor — solemn baroque key.
const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
// MIDI helpers
const D4 = 62, A4 = 69, D5 = 74, F5 = 77, A5 = 81, C5 = 72, E5 = 76, G5 = 79;
const D3 = 50, A3 = 57, F3 = 53, G3 = 55, E3 = 52;

export const sfx = {
  click: () => {
    tone(1600, 0.03, { type: "square", gain: 0.05, reverb: 0.05 });
    tone(2400, 0.02, { type: "triangle", gain: 0.04, delay: 0.005, reverb: 0.05 });
  },
  brush: () => {
    noise(0.22, 0.07, 0, 2800, "bandpass", 0.6);
    noise(0.18, 0.04, 0.02, 6000, "highpass", 0.4);
  },
  pencil: () => {
    noise(0.05, 0.05, 0, 4500, "bandpass", 1.5);
    noise(0.04, 0.03, 0.01, 7000, "highpass", 0.4);
  },
  snap: () => {
    tone(140, 0.14, { type: "sine", gain: 0.22, reverb: 0.25 });
    tone(280, 0.08, { type: "triangle", gain: 0.12, delay: 0.005 });
    noise(0.05, 0.14, 0, 900, "bandpass", 2);
  },
  ready: () => {
    // Minor 3rd → 5th flourish.
    pluck(NOTE(D5), 0.7, 0, 0.16);
    pluck(NOTE(F5), 0.7, 0.08, 0.14);
    pluck(NOTE(A5), 0.9, 0.16, 0.14);
  },
  alarm: () => {
    // Brass-like, dissonant tritone pulse.
    for (let i = 0; i < 3; i++) {
      tone(NOTE(A4), 0.18, { type: "sawtooth", gain: 0.16, delay: i * 0.14, filterHz: 2200, filterQ: 2, reverb: 0.15 });
      tone(NOTE(D5) * Math.pow(2, 1 / 12) /* Eb */, 0.18, { type: "sawtooth", gain: 0.14, delay: i * 0.14 + 0.01, filterHz: 2200, filterQ: 2, reverb: 0.15 });
    }
  },
  shatter: () => {
    noise(0.5, 0.22, 0, 6500, "highpass", 0.4);
    // Glass chimes cascade.
    [2400, 3100, 3900, 4700, 5600].forEach((f, i) =>
      tone(f, 0.35, { type: "triangle", gain: 0.08, delay: i * 0.035, reverb: 0.5, attack: 0.002, release: 0.35 })
    );
    tone(160, 0.15, { type: "sine", gain: 0.14 });
  },
  victory: () => {
    // Grand baroque cadence — D minor → A → D major (Picardy third).
    // Melody (harpsichord-like plucks)
    const t = 0;
    const beat = 0.28;
    const mel = [
      { n: D5, d: 1 }, { n: F5, d: 1 }, { n: A5, d: 2 },
      { n: G5, d: 1 }, { n: F5, d: 1 }, { n: E5, d: 1 }, { n: D5, d: 2 },
      { n: A4, d: 1 }, { n: D5, d: 3 },
    ];
    let cursor = t;
    mel.forEach(({ n, d }) => {
      pluck(NOTE(n), d * beat + 0.1, cursor, 0.18, 0.5);
      cursor += d * beat;
    });
    // Bass line
    const bass = [
      { n: D3, d: 4 }, { n: A3, d: 3 }, { n: D3, d: 6 },
    ];
    cursor = t;
    bass.forEach(({ n, d }) => {
      cello(NOTE(n), d * beat, cursor, 0.11);
      cursor += d * beat;
    });
    // Sustained chord pad on final beat.
    [D4, NOTE(66) /* F# = Picardy */, A4, D5].forEach((f, i) =>
      tone(typeof f === "number" && f > 200 ? f : NOTE(f), 1.6, {
        type: "triangle", gain: 0.06, delay: 10 * beat, reverb: 0.7, attack: 0.4, release: 1.6,
      })
    );
  },
  defeat: () => {
    // Low, out-of-tune cello descent — dissonant, vibrating.
    const seq = [
      { n: A3, d: 1.1, det: -18 },
      { n: G3, d: 1.2, det: 22 },
      { n: F3, d: 1.3, det: -30 },
      { n: E3, d: 2.2, det: 35 },
    ];
    let cursor = 0;
    seq.forEach(({ n, d, det }) => {
      cello(NOTE(n), d, cursor, 0.16, det);
      // Doubled a tritone below for menace.
      cello(NOTE(n) * 0.5, d, cursor, 0.06, det + 8);
      cursor += d * 0.55;
    });
  },
  chest: () => {
    // Rising baroque arpeggio + shimmer.
    [D5, F5, A5, D5 + 12].forEach((n, i) =>
      pluck(NOTE(n), 0.6, i * 0.07, 0.18, 0.6)
    );
    [C5 + 12, E5 + 12, G5 + 12].forEach((n, i) =>
      tone(NOTE(n), 0.9, { type: "triangle", gain: 0.08, delay: 0.3 + i * 0.06, reverb: 0.7, attack: 0.002, release: 0.9 })
    );
    noise(0.5, 0.06, 0, 8000, "highpass", 0.3);
  },
  penalty: () => {
    tone(110, 0.35, { type: "sawtooth", gain: 0.16, filterHz: 700, filterQ: 3, reverb: 0.1 });
    tone(82, 0.35, { type: "sawtooth", gain: 0.1, filterHz: 600, filterQ: 3, delay: 0.02 });
  },
};

/* ---------- Ambient music ---------- */

// Slow harpsichord-like loop in D minor. Scheduled on a rolling window.

interface MusicState {
  running: boolean;
  next: number;
  step: number;
  timer: number | null;
}
const music: MusicState = { running: false, next: 0, step: 0, timer: null };

// MIDI chord progression: i - VII - VI - V (Dm - C - Bb - A)
const CHORDS: number[][] = [
  [50, 53, 57, 62, 65],           // Dm
  [48, 52, 55, 60, 64],           // C
  [46, 50, 53, 58, 62],           // Bb
  [45, 49, 52, 57, 61],           // A (major, dominant)
];
// Arpeggio patterns (indexes into chord tones)
const PATTERN = [0, 2, 3, 2, 1, 2, 3, 4];

function scheduleBar(a: AudioContext, when: number, chord: number[]) {
  const beat = 0.42;
  // Bass pedal
  cello(NOTE(chord[0] - 12), beat * 8, when - a.currentTime, 0.06);
  // Harpsichord arpeggio
  PATTERN.forEach((p, i) => {
    const midi = chord[p % chord.length] + 12;
    const g = 0.09 + (i % 4 === 0 ? 0.03 : 0);
    // Pluck with music-bus routing (louder reverb, quieter body).
    scheduleMusicPluck(a, NOTE(midi), 0.55, when + i * beat - a.currentTime, g);
  });
  // Occasional flute-like top note
  if (Math.random() < 0.6) {
    scheduleMusicTone(a, NOTE(chord[2] + 24), 1.2, when + beat * (2 + Math.random() * 4) - a.currentTime, 0.05);
  }
}

function scheduleMusicPluck(a: AudioContext, freq: number, dur: number, delay: number, gain: number) {
  if (!musicBus) return;
  const t0 = a.currentTime + Math.max(0, delay);
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const filt = a.createBiquadFilter();
  filt.type = "lowpass";
  filt.Q.value = 4;
  filt.frequency.setValueAtTime(freq * 10, t0);
  filt.frequency.exponentialRampToValueAtTime(freq * 2.5, t0 + dur);
  filt.connect(g).connect(musicBus);
  if (reverb) {
    const s = a.createGain();
    s.gain.value = 0.6;
    g.connect(s).connect(reverb);
  }
  for (let i = 0; i < 2; i++) {
    const o = a.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = i === 0 ? -7 : 7;
    o.connect(filt);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

function scheduleMusicTone(a: AudioContext, freq: number, dur: number, delay: number, gain: number) {
  if (!musicBus) return;
  const t0 = a.currentTime + Math.max(0, delay);
  const o = a.createOscillator();
  o.type = "triangle";
  o.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(musicBus);
  if (reverb) {
    const s = a.createGain();
    s.gain.value = 0.7;
    g.connect(s).connect(reverb);
  }
  o.start(t0);
  o.stop(t0 + dur + 0.1);
}

export function startMusic() {
  const a = ac();
  if (!a || music.running) return;
  music.running = true;
  music.step = 0;
  music.next = a.currentTime + 0.1;
  const tick = () => {
    if (!music.running || !ctx) return;
    // Schedule up to 2 bars ahead.
    while (music.next < ctx.currentTime + 2.5) {
      const chord = CHORDS[music.step % CHORDS.length];
      scheduleBar(ctx, music.next, chord);
      music.next += 0.42 * 8;
      music.step += 1;
    }
    music.timer = window.setTimeout(tick, 500);
  };
  tick();
}

export function stopMusic() {
  music.running = false;
  if (music.timer) window.clearTimeout(music.timer);
  music.timer = null;
  if (musicBus && ctx) {
    const t = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(musicBus.gain.value, t);
    musicBus.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    setTimeout(() => { if (musicBus) musicBus.gain.value = 0.28; }, 500);
  }
}

export function setMusicVolume(v: number) {
  if (musicBus) musicBus.gain.value = Math.max(0, Math.min(1, v));
}

export function setSfxVolume(v: number) {
  if (sfxBus) sfxBus.gain.value = Math.max(0, Math.min(1, v));
}