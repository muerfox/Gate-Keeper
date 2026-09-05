import type { ChallengeRenderer } from "../types.js";
import { el } from "../dom.js";

export const dynamicInteractionRenderer: ChallengeRenderer = {
  render(root, challenge, collector) {
    return new Promise((resolve) => {
      const payload = challenge.payload as { instruction: string; cueDelayMs: number };
      const btn = el("button", { type: "button", class: "gk-btn", style: "width: 100%; padding: 20px;" }, ["Press and hold"]);
      let holdStart: number | null = null;
      let cueTimer: ReturnType<typeof setTimeout> | null = null;
      let cued = false;

      const start = () => {
        if (holdStart !== null) return;
        holdStart = performance.now();
        cued = false;
        collector.record("pointerdown");
        cueTimer = setTimeout(() => {
          cued = true;
          btn.textContent = "Release now!";
          btn.style.background = "#22c55e";
        }, payload.cueDelayMs);
      };

      const end = () => {
        if (holdStart === null) return;
        const heldMs = performance.now() - holdStart;
        holdStart = null;
        if (cueTimer) clearTimeout(cueTimer);
        collector.record("pointerup");
        void cued;
        resolve({ heldMs });
      };

      btn.addEventListener("pointerdown", start);
      btn.addEventListener("pointerup", end);
      btn.addEventListener("pointerleave", () => {
        if (holdStart !== null) end();
      });
      btn.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          start();
        }
      });
      btn.addEventListener("keyup", (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          end();
        }
      });

      root.append(el("p", { class: "gk-instruction" }, [payload.instruction]), btn);
    });
  },
};
