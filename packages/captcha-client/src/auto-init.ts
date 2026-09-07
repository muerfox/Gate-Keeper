import { GateKeeperWidget } from "./widget.js";
import type { GateKeeperError } from "./types.js";

/**
 * HTML widget auto-initialization:
 * <div data-gatekeeper data-site-key="GK_PUBLIC_KEY" data-action="signup"></div>
 *
 * Supports optional `data-callback` / `data-error-callback` attributes
 * naming a global function (matching the convention integrators expect
 * from data-attribute-driven CAPTCHA widgets), and always dispatches
 * `gatekeeper:success` / `gatekeeper:failure` CustomEvents on the element
 * for integrators who prefer addEventListener.
 */
export function autoInit(root: ParentNode = document): void {
  const elements = root.querySelectorAll<HTMLElement>("[data-gatekeeper]");
  for (const element of Array.from(elements)) {
    if (element.dataset.gkInitialized) continue;
    element.dataset.gkInitialized = "true";

    const siteKey = element.dataset.siteKey;
    const action = element.dataset.action;
    if (!siteKey || !action) {
      // eslint-disable-next-line no-console
      console.error("Gate Keeper: element with data-gatekeeper is missing data-site-key or data-action", element);
      continue;
    }

    const widget = new GateKeeperWidget(element, {
      siteKey,
      action,
      apiUrl: element.dataset.apiUrl,
      accessible: element.dataset.accessible === "true",
      theme: (element.dataset.theme as "light" | "dark" | "auto") || "auto",
      onSuccess(token) {
        element.dispatchEvent(new CustomEvent("gatekeeper:success", { detail: { token }, bubbles: true }));
        callNamedCallback(element.dataset.callback, token);
      },
      onFailure(error: GateKeeperError) {
        element.dispatchEvent(new CustomEvent("gatekeeper:failure", { detail: { error }, bubbles: true }));
        callNamedCallback(element.dataset.errorCallback, error);
      },
    });
    void widget.run();
  }
}

function callNamedCallback(name: string | undefined, arg: unknown): void {
  if (!name) return;
  const fn = (window as unknown as Record<string, unknown>)[name];
  if (typeof fn === "function") (fn as (arg: unknown) => void)(arg);
}

export function installAutoInit(): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => autoInit());
  } else {
    autoInit();
  }
}
