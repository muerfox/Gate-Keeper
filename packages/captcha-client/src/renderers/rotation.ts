import type { ChallengeRenderer } from "../types.js";
import { el } from "../dom.js";
import { shapeElement } from "./shapes.js";

/** A native `<input type="range">` — keyboard-operable (arrow keys) by
 * default, unlike a custom pointer-drag-only rotation knob would be. */
export const rotationRenderer: ChallengeRenderer = {
  render(root, challenge, collector) {
    return new Promise((resolve) => {
      const payload = challenge.payload as { instruction: string; shape: string; startRotationDeg: number };
      let angle = payload.startRotationDeg;

      const preview = el("div", { class: "gk-tile", style: "aspect-ratio: unset; height: 100px; margin-bottom: 10px;" });
      const shape = shapeElement(payload.shape, "blue", angle, "50%");
      preview.append(shape);

      const slider = el("input", { type: "range", min: "0", max: "359", value: String(angle), "aria-label": "Rotation angle" }) as HTMLInputElement;
      slider.addEventListener("input", () => {
        angle = Number(slider.value);
        shape.style.transform = `rotate(${angle}deg)`;
        collector.record("pointermove");
      });

      const submit = el("button", { type: "button", class: "gk-btn" }, ["Verify"]);
      submit.addEventListener("click", () => resolve(angle));

      root.append(el("p", { class: "gk-instruction" }, [payload.instruction]), preview, slider, el("div", { class: "gk-btn-row" }, [submit]));
    });
  },
};
