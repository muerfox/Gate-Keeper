import type { ChallengeRenderer } from "../types.js";
import { el } from "../dom.js";
import { shapeElement } from "./shapes.js";

/** Supports both native pointer drag AND a "select item, then select zone"
 * click/keyboard alternative — native HTML5 drag-and-drop has no keyboard
 * equivalent, so a pure drag-only implementation would fail WCAG's
 * keyboard-operable requirement (docs/ACCESSIBILITY.md). */
export const dragDropRenderer: ChallengeRenderer = {
  render(root, challenge, collector) {
    return new Promise((resolve) => {
      const payload = challenge.payload as {
        instruction: string;
        items: { id: string; shape: string }[];
        zones: { id: string; shape: string }[];
      };

      const mapping: Record<string, string> = {};
      let activeItem: string | null = null;

      const itemsRow = el("div", { class: "gk-grid", role: "group", "aria-label": "Items to place" });
      const zonesRow = el("div", { class: "gk-grid", role: "group", "aria-label": "Drop targets" });

      const itemButtons = new Map<string, HTMLButtonElement>();
      for (const item of payload.items) {
        const btn = el("button", { type: "button", class: "gk-tile", "aria-label": `${item.shape} piece`, draggable: "true" }) as HTMLButtonElement;
        btn.append(shapeElement(item.shape, "blue"));
        btn.addEventListener("dragstart", (e) => {
          e.dataTransfer?.setData("text/plain", item.id);
          collector.record("drag");
        });
        btn.addEventListener("click", () => {
          activeItem = item.id;
          for (const b of itemButtons.values()) b.setAttribute("aria-pressed", "false");
          btn.setAttribute("aria-pressed", "true");
        });
        itemButtons.set(item.id, btn);
        itemsRow.append(btn);
      }

      const maybeResolve = () => {
        if (Object.keys(mapping).length === payload.items.length) resolve(mapping);
      };

      for (const zone of payload.zones) {
        const zoneEl = el("button", { type: "button", class: "gk-tile", "aria-label": `Drop zone: ${zone.shape} outline`, style: "opacity: 0.5;" }) as HTMLButtonElement;
        zoneEl.append(shapeElement(zone.shape, "teal", 0, "60%"));
        zoneEl.addEventListener("dragover", (e) => e.preventDefault());
        zoneEl.addEventListener("drop", (e) => {
          e.preventDefault();
          const itemId = e.dataTransfer?.getData("text/plain");
          if (itemId) {
            mapping[itemId] = zone.id;
            itemButtons.get(itemId)?.setAttribute("disabled", "true");
            collector.record("drop");
            maybeResolve();
          }
        });
        zoneEl.addEventListener("click", () => {
          if (!activeItem) return;
          mapping[activeItem] = zone.id;
          itemButtons.get(activeItem)?.setAttribute("disabled", "true");
          activeItem = null;
          collector.record("drop");
          maybeResolve();
        });
        zonesRow.append(zoneEl);
      }

      root.append(
        el("p", { class: "gk-instruction" }, [payload.instruction]),
        el("p", { class: "gk-status" }, ["Drag each piece onto its outline, or tap a piece then tap its outline."]),
        itemsRow,
        zonesRow,
      );
    });
  },
};
