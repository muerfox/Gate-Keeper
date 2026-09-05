import type { ChallengeRenderer } from "../types.js";
import { el } from "../dom.js";
import { shapeElement } from "./shapes.js";

interface Tile {
  id: string;
  shape?: string;
  color?: string;
  rotationDeg?: number;
  icon?: string;
}

/** Multi-select grid used by both `visual_object_selection` and
 * `image_classification` (packages/challenges) — both are "tap every tile
 * matching the instruction" challenges, differing only in how a tile is
 * drawn (a colored shape vs. a labeled icon placeholder). */
export const tileSelectionRenderer: ChallengeRenderer = {
  render(root, challenge, collector) {
    return new Promise((resolve) => {
      const payload = challenge.payload as { instruction: string; tiles: Tile[] };
      const selected = new Set<string>();

      const instruction = el("p", { class: "gk-instruction" }, [payload.instruction]);
      const grid = el("div", { class: "gk-grid", role: "group", "aria-label": payload.instruction });

      for (const tile of payload.tiles) {
        const btn = el("button", {
          type: "button",
          class: "gk-tile",
          "aria-pressed": "false",
          "aria-label": tile.icon ?? `${tile.color ?? ""} ${tile.shape ?? ""}`.trim(),
        });
        if (tile.shape) {
          btn.append(shapeElement(tile.shape, tile.color ?? "blue", tile.rotationDeg ?? 0));
        } else if (tile.icon) {
          btn.textContent = tile.icon.slice(0, 2).toUpperCase();
        }
        btn.addEventListener("click", () => {
          const isSelected = selected.has(tile.id);
          if (isSelected) selected.delete(tile.id);
          else selected.add(tile.id);
          btn.setAttribute("aria-pressed", String(!isSelected));
          collector.record("pointerdown");
        });
        grid.append(btn);
      }

      const submit = el("button", { type: "button", class: "gk-btn" }, ["Verify"]);
      submit.addEventListener("click", () => resolve(Array.from(selected)));

      root.append(instruction, grid, el("div", { class: "gk-btn-row" }, [submit]));
    });
  },
};
