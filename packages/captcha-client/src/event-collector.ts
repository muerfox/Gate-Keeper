import type { InteractionEvent } from "@gatekeeper/shared";
import { MAX_INTERACTION_EVENTS } from "@gatekeeper/shared";
import type { EventCollectorHandle } from "./types.js";

/**
 * Collects raw interaction events for the server's behavioral consistency
 * analysis (Layer 3, docs/ARCHITECTURE.md). Timestamps are relative to
 * challenge render start via `performance.now()`, not wall-clock time —
 * this is the SAME timer the server-observed solve duration is compared
 * against, and using a monotonic clock avoids trivial tampering via
 * `Date.now()`/`Date` overrides (still not a strong guarantee against a
 * fully instrumented browser, per docs/THREAT_MODEL.md, but removes the
 * cheapest tampering vector).
 *
 * Bounded to MAX_INTERACTION_EVENTS so a long-lived or pathological
 * challenge session cannot grow an unbounded payload (docs/THREAT_MODEL.md
 * §4.11) — oldest pointermove samples are dropped first since they carry
 * the least individual signal; down/up/focus/key events are always kept.
 */
export function createEventCollector(root: HTMLElement | ShadowRoot): EventCollectorHandle {
  const start = performance.now();
  const events: InteractionEvent[] = [];
  const highValueTypes = new Set(["pointerdown", "pointerup", "keydown", "keyup", "focus", "blur", "visibilitychange", "drag", "drop"]);

  function record(type: string, extra?: { x?: number; y?: number; key?: string }): void {
    const event: InteractionEvent = { t: Math.round(performance.now() - start), type: type as InteractionEvent["type"], ...extra };

    if (events.length >= MAX_INTERACTION_EVENTS) {
      if (!highValueTypes.has(type)) return;
      const droppedIndex = events.findIndex((e) => e.type === "pointermove");
      if (droppedIndex >= 0) events.splice(droppedIndex, 1);
      else events.shift();
    }
    events.push(event);
  }

  const onPointerMove = (e: PointerEvent) => record("pointermove", { x: e.clientX, y: e.clientY });
  const onPointerDown = (e: PointerEvent) => record("pointerdown", { x: e.clientX, y: e.clientY });
  const onPointerUp = (e: PointerEvent) => record("pointerup", { x: e.clientX, y: e.clientY });
  const onKeyDown = (e: KeyboardEvent) => record("keydown", { key: e.key.length === 1 ? "char" : e.key });
  const onKeyUp = (e: KeyboardEvent) => record("keyup", { key: e.key.length === 1 ? "char" : e.key });
  const onFocusIn = () => record("focus");
  const onFocusOut = () => record("blur");
  const onVisibility = () => record("visibilitychange");

  const target = root as unknown as HTMLElement;
  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("focusin", onFocusIn);
  target.addEventListener("focusout", onFocusOut);
  document.addEventListener("visibilitychange", onVisibility);

  return {
    record,
    drain() {
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerdown", onPointerDown);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("focusin", onFocusIn);
      target.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onVisibility);
      return events.slice();
    },
  };
}
