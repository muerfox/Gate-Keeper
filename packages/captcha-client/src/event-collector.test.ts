// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from "vitest";
import { createEventCollector } from "./event-collector.js";

// jsdom does not implement PointerEvent (only MouseEvent); the properties
// this module actually reads (clientX/clientY) are identical, so a thin
// MouseEvent-based stand-in is sufficient for these tests.
beforeAll(() => {
  if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === "undefined") {
    (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = MouseEvent;
  }
});

describe("createEventCollector", () => {
  it("records events with monotonically non-decreasing relative timestamps", async () => {
    const div = document.createElement("div");
    document.body.append(div);
    const collector = createEventCollector(div);

    div.dispatchEvent(new PointerEvent("pointerdown", { clientX: 1, clientY: 2, bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
    div.dispatchEvent(new PointerEvent("pointerup", { clientX: 3, clientY: 4, bubbles: true }));

    const events = collector.drain();
    expect(events.length).toBe(2);
    expect(events[0]!.type).toBe("pointerdown");
    expect(events[1]!.type).toBe("pointerup");
    expect(events[1]!.t).toBeGreaterThanOrEqual(events[0]!.t);
  });

  it("caps total event count and prefers dropping pointermove samples", () => {
    const div = document.createElement("div");
    document.body.append(div);
    const collector = createEventCollector(div);

    for (let i = 0; i < 600; i++) {
      div.dispatchEvent(new PointerEvent("pointermove", { clientX: i, clientY: i, bubbles: true }));
    }
    div.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    const events = collector.drain();
    expect(events.length).toBeLessThanOrEqual(500);
    expect(events.some((e) => e.type === "pointerdown")).toBe(true);
  });

  it("removes its listeners on drain", () => {
    const div = document.createElement("div");
    document.body.append(div);
    const collector = createEventCollector(div);
    collector.drain();

    div.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(collector.drain()).toHaveLength(0);
  });
});
