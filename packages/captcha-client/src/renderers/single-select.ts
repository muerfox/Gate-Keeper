import type { ChallengeRenderer } from "../types.js";
import { el } from "../dom.js";
import { shapeElement } from "./shapes.js";

/** Single-select-then-submit renderer shared by `spatial_reasoning`
 * (options carry an angle) and `pattern_recognition` (tiles carry a
 * shape/color) — both ask "pick the one option that's different/correct." */
export function makeSingleSelectRenderer(kind: "spatial_reasoning" | "pattern_recognition"): ChallengeRenderer {
  return {
    render(root, challenge, collector) {
      return new Promise((resolve) => {
        const payload = challenge.payload as {
          instruction: string;
          shape?: string;
          sequence?: number[];
          options?: { id: string; angle: number }[];
          tiles?: { id: string; shape: string; color: string }[];
        };

        let selectedId: string | null = null;
        const instruction = el("p", { class: "gk-instruction" }, [payload.instruction]);
        const grid = el("div", { class: "gk-grid", role: "group", "aria-label": payload.instruction });

        if (kind === "spatial_reasoning" && payload.sequence) {
          const preview = el("div", { class: "gk-grid", style: "grid-template-columns: repeat(3, 1fr); margin-bottom: 8px;" });
          for (const angle of payload.sequence) {
            const cell = el("div", { class: "gk-tile", "aria-hidden": "true" }, [shapeElement(payload.shape ?? "triangle", "blue", angle)]);
            preview.append(cell);
          }
          root.append(preview);
        }

        const items = kind === "spatial_reasoning" ? (payload.options ?? []) : (payload.tiles ?? []);
        for (const item of items) {
          const btn = el("button", { type: "button", class: "gk-tile", "aria-pressed": "false" });
          if ("angle" in item) btn.append(shapeElement(payload.shape ?? "triangle", "blue", item.angle));
          else btn.append(shapeElement(item.shape, item.color));
          btn.addEventListener("click", () => {
            for (const child of Array.from(grid.children)) child.setAttribute("aria-pressed", "false");
            btn.setAttribute("aria-pressed", "true");
            selectedId = item.id;
            submit.disabled = false;
            collector.record("pointerdown");
          });
          grid.append(btn);
        }

        const submit = el("button", { type: "button", class: "gk-btn", disabled: "true" }, ["Verify"]) as HTMLButtonElement;
        submit.disabled = true;
        submit.addEventListener("click", () => resolve(selectedId));

        root.append(instruction, grid, el("div", { class: "gk-btn-row" }, [submit]));
      });
    },
  };
}
