import type { ChallengeRenderer } from "../types.js";
import { el } from "../dom.js";

/** Plain-text multiple choice — the lowest-friction visual challenge in
 * the general rotation: one click, no fine motor precision, no timing,
 * no color/shape discrimination. Real `<button>` elements (not a custom
 * listbox) so Tab/Enter/Space work with no extra ARIA wiring
 * (docs/ACCESSIBILITY.md: prefer native semantics over custom widgets). */
export const commonSenseChoiceRenderer: ChallengeRenderer = {
  render(root, challenge, collector) {
    return new Promise((resolve) => {
      const payload = challenge.payload as { instruction: string; options: { id: string; text: string }[] };

      let selectedId: string | null = null;
      const instruction = el("p", { class: "gk-instruction" }, [payload.instruction]);
      const list = el("div", { class: "gk-option-list", role: "group", "aria-label": payload.instruction });

      for (const option of payload.options) {
        const btn = el("button", { type: "button", class: "gk-option", "aria-pressed": "false" }, [option.text]);
        btn.addEventListener("click", () => {
          for (const child of Array.from(list.children)) child.setAttribute("aria-pressed", "false");
          btn.setAttribute("aria-pressed", "true");
          selectedId = option.id;
          submit.disabled = false;
          collector.record("pointerdown");
        });
        list.append(btn);
      }

      const submit = el("button", { type: "button", class: "gk-btn", disabled: "true" }, ["Verify"]) as HTMLButtonElement;
      submit.disabled = true;
      submit.addEventListener("click", () => resolve(selectedId));

      root.append(instruction, list, el("div", { class: "gk-btn-row" }, [submit]));
    });
  },
};
