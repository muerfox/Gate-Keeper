import type { ChallengeRenderer } from "../types.js";
import { el } from "../dom.js";
import { shapeElement } from "./shapes.js";

export const sequenceRecognitionRenderer: ChallengeRenderer = {
  render(root, challenge, collector) {
    return new Promise((resolve) => {
      const payload = challenge.payload as { instruction: string; palette: string[]; sequence: string[]; revealMsPerStep: number };
      const status = el("p", { class: "gk-status", role: "status" }, ["Watch closely..."]);
      const display = el("div", { class: "gk-grid", style: "grid-template-columns: 1fr; aspect-ratio: unset; margin-bottom: 8px;" });
      const cell = el("div", { class: "gk-tile", style: "aspect-ratio: unset; height: 64px;", "aria-hidden": "true" });
      display.append(cell);

      const reproduction: string[] = [];
      const paletteRow = el("div", { class: "gk-grid" });
      for (const symbol of payload.palette) {
        const btn = el("button", { type: "button", class: "gk-tile", "aria-label": symbol, disabled: "true" });
        btn.append(shapeElement(symbol, "blue"));
        (btn as HTMLButtonElement).disabled = true;
        btn.addEventListener("click", () => {
          reproduction.push(symbol);
          collector.record("pointerdown");
          status.textContent = `${reproduction.length} / ${payload.sequence.length}`;
          if (reproduction.length >= payload.sequence.length) {
            resolve(reproduction);
          }
        });
        paletteRow.append(btn);
      }

      root.append(el("p", { class: "gk-instruction" }, [payload.instruction]), display, status, paletteRow);

      let i = 0;
      const step = () => {
        if (i >= payload.sequence.length) {
          cell.textContent = "";
          status.textContent = "Now repeat it.";
          for (const btn of Array.from(paletteRow.children)) (btn as HTMLButtonElement).disabled = false;
          return;
        }
        cell.replaceChildren(shapeElement(payload.sequence[i] as string, "blue"));
        setTimeout(() => {
          cell.replaceChildren();
          i++;
          setTimeout(step, payload.revealMsPerStep / 3);
        }, (payload.revealMsPerStep * 2) / 3);
      };
      setTimeout(step, 400);
    });
  },
};
