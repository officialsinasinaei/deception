// Mannequin figure poses defined as normalized SVG paths (viewBox 0 0 100 200).
// Fixed size — no scaling per GDD.

export type FigureId = 0 | 1 | 2;

export interface FigurePose {
  id: FigureId;
  name: string;
  // Path in normalized 100x200 viewport
  path: string;
}

export const FIGURE_W = 90;
export const FIGURE_H = 180;

// Simple silhouette poses — head, torso, limbs. Rendered as filled paths.
export const POSES: FigurePose[] = [
  {
    id: 0,
    name: "Standing",
    // Head (circle), torso, arms down, legs
    path:
      "M50 12 C60 12 68 20 68 30 C68 40 60 48 50 48 C40 48 32 40 32 30 C32 20 40 12 50 12 Z " +
      "M38 50 L62 50 L66 100 L60 150 L58 190 L52 190 L50 155 L48 190 L42 190 L40 150 L34 100 Z " +
      "M30 55 L38 55 L34 120 L28 120 Z " +
      "M62 55 L70 55 L72 120 L66 120 Z",
  },
  {
    id: 1,
    name: "Reaching",
    // Head, torso leaning, one arm raised, one bent
    path:
      "M55 10 C65 10 72 18 72 28 C72 38 65 46 55 46 C45 46 38 38 38 28 C38 18 45 10 55 10 Z " +
      "M44 48 L66 48 L74 100 L70 150 L66 188 L60 188 L56 150 L50 188 L44 188 L42 150 L38 100 Z " +
      "M66 50 L78 50 L92 12 L86 8 L74 46 Z " +
      "M40 52 L48 52 L36 92 L28 88 Z",
  },
  {
    id: 2,
    name: "Seated",
    // Head, compact torso, bent legs
    path:
      "M50 20 C60 20 68 28 68 38 C68 48 60 56 50 56 C40 56 32 48 32 38 C32 28 40 20 50 20 Z " +
      "M36 58 L64 58 L70 110 L64 130 L36 130 L30 110 Z " +
      "M30 130 L70 130 L88 145 L86 155 L64 150 L64 175 L58 175 L54 150 L46 150 L42 175 L36 175 L36 150 L14 155 L12 145 Z " +
      "M28 60 L36 60 L30 95 L22 92 Z " +
      "M64 60 L72 60 L80 95 L72 98 Z",
  },
];

// Build a Path2D from a pose scaled into an [w,h] box centred at origin.
export function posePath2D(pose: FigurePose, w = FIGURE_W, h = FIGURE_H): Path2D {
  // Path is authored in a 100x200 box; scale by (w/100, h/200) and translate to center at (0,0).
  const p = new Path2D();
  const src = new Path2D(pose.path);
  const m = new DOMMatrix().translate(-w / 2, -h / 2).scale(w / 100, h / 200);
  p.addPath(src, m);
  return p;
}
