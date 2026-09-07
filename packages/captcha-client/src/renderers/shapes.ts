/** Renders a procedurally-described shape (no image assets — matches the
 * server generator's structured payload, packages/challenges) as a small
 * inline SVG. Kept in one place so every renderer that shows a shape
 * (visual selection, spatial reasoning, pattern recognition, rotation)
 * stays visually consistent. */
const CLIP_PATHS: Record<string, string> = {
  triangle: "polygon(50% 0%, 0% 100%, 100% 100%)",
  star: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
  hexagon: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
  pentagon: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
};

const COLOR_HEX: Record<string, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  amber: "#f59e0b",
  violet: "#8b5cf6",
  teal: "#14b8a6",
};

export function shapeElement(shape: string, color: string, rotationDeg = 0, size = "70%"): HTMLDivElement {
  const div = document.createElement("div");
  div.style.width = size;
  div.style.height = size;
  div.style.background = COLOR_HEX[color] ?? "#94a3b8";
  div.style.transform = `rotate(${rotationDeg}deg)`;
  if (shape === "circle") div.style.borderRadius = "50%";
  else if (shape === "square") div.style.borderRadius = "3px";
  else if (CLIP_PATHS[shape]) div.style.clipPath = CLIP_PATHS[shape];
  return div;
}
