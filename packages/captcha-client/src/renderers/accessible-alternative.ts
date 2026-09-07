import type { ChallengeRenderer } from "../types.js";
import { el } from "../dom.js";

/** A native `<select>` + submit button — the most reliably screen-reader-
 * and keyboard-accessible pattern available, deliberately avoiding a
 * custom ARIA listbox reimplementation (docs/ACCESSIBILITY.md: prefer
 * native semantics over custom widgets wherever the native element does
 * the job). */
export const accessibleAlternativeRenderer: ChallengeRenderer = {
  render(root, challenge, collector) {
    return new Promise((resolve) => {
      const payload = challenge.payload as { instruction: string; options: { id: string; word: string }[] };

      const labelId = "gk-accessible-label";
      const label = el("label", { id: labelId, for: "gk-accessible-select" }, [payload.instruction]);
      label.style.display = "block";
      label.style.marginBottom = "8px";

      const select = el("select", { id: "gk-accessible-select", "aria-labelledby": labelId }) as HTMLSelectElement;
      select.append(el("option", { value: "" }, ["Choose an answer…"]));
      for (const option of payload.options) {
        select.append(el("option", { value: option.id }, [option.word]));
      }
      select.addEventListener("change", () => collector.record("keydown"));

      const submit = el("button", { type: "button", class: "gk-btn" }, ["Verify"]);
      submit.addEventListener("click", () => {
        if (select.value) resolve(select.value);
      });

      root.append(label, select, el("div", { class: "gk-btn-row", style: "margin-top: 10px;" }, [submit]));
      select.focus();
    });
  },
};
