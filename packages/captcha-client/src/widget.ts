import type { PublicChallenge } from "@gatekeeper/shared";
import { ApiClient } from "./api-client.js";
import { createEventCollector } from "./event-collector.js";
import { RENDERERS } from "./registry.js";
import { el, WIDGET_STYLES } from "./dom.js";
import { GateKeeperError, type RenderOptions } from "./types.js";

const LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="10" width="16" height="10" rx="2" stroke="#3b82f6" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="#3b82f6" stroke-width="2"/></svg>`;

/**
 * Orchestrates one Gate Keeper verification: request a challenge, render
 * it, collect interaction events, submit the answer, and follow the
 * server's adaptive escalation loop (CHALLENGE_REQUIRED -> render the next,
 * harder challenge) until a terminal outcome. Nothing here makes a trust
 * decision — every outcome comes from the server (docs/THREAT_MODEL.md).
 */
export class GateKeeperWidget {
  private readonly api: ApiClient;
  private readonly shadowHost: HTMLElement;
  private readonly shadowRoot: ShadowRoot;
  private readonly contentRoot: HTMLElement;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: RenderOptions,
  ) {
    this.api = new ApiClient(options.apiUrl);
    this.shadowHost = container;
    this.shadowRoot = container.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = WIDGET_STYLES;
    this.shadowRoot.append(style);

    this.contentRoot = el("div", { class: "gk-root", role: "region", "aria-label": "Gate Keeper verification" });
    if (options.theme && options.theme !== "auto") this.contentRoot.dataset.theme = options.theme;
    this.shadowRoot.append(this.contentRoot);
  }

  async run(): Promise<void> {
    try {
      const first = await this.api.requestChallenge({
        siteKey: this.options.siteKey,
        action: this.options.action,
        accessible: this.options.accessible,
      });
      await this.solveLoop(first);
    } catch (err) {
      this.fail(err instanceof GateKeeperError ? err : new GateKeeperError("network_error", String(err)));
    }
  }

  private async solveLoop(challenge: PublicChallenge): Promise<void> {
    this.options.onChallenge?.(challenge);
    this.contentRoot.replaceChildren(this.header(), ...this.statusNodes("Loading challenge…"));

    const renderer = RENDERERS[challenge.type];
    const body = el("div");
    this.contentRoot.replaceChildren(this.header(), body);

    const collector = createEventCollector(this.shadowRoot);
    let answer: unknown;
    try {
      answer = await renderer.render(body, challenge, collector);
    } finally {
      // Renderer promises for computational types resolve immediately
      // without user interaction; drain() is still safe to call once.
    }
    const events = collector.drain();

    this.contentRoot.replaceChildren(this.header(), ...this.statusNodes("Verifying…"));

    const result = await this.api.submitAnswer({
      siteKey: this.options.siteKey,
      action: this.options.action,
      challengeId: challenge.id,
      signedEnvelope: challenge.signedEnvelope,
      answer,
      events,
    });

    if (result.success && result.token) {
      this.succeed(result.token);
      return;
    }

    if (result.outcome === "CHALLENGE_REQUIRED" && result.nextChallenge) {
      await this.solveLoop(result.nextChallenge);
      return;
    }

    this.fail(new GateKeeperError(result.outcome ?? "verification_failed", "Verification failed"));
  }

  private header(): HTMLElement {
    const logo = el("span", { class: "gk-logo" });
    logo.innerHTML = LOGO_SVG;
    return el("div", { class: "gk-header" }, [logo, el("span", { class: "gk-title" }, ["Gate Keeper"]), el("span", { class: "gk-tagline" }, ["Protected"])]);
  }

  private statusNodes(message: string): HTMLElement[] {
    return [el("div", { class: "gk-spinner", "aria-hidden": "true" }), el("p", { class: "gk-status", role: "status" }, [message])];
  }

  private succeed(token: string): void {
    this.contentRoot.replaceChildren(this.header(), el("p", { class: "gk-status" }, ["Verified."]));
    this.options.onSuccess?.(token);
  }

  private fail(error: GateKeeperError): void {
    this.contentRoot.replaceChildren(this.header(), el("p", { class: "gk-status gk-error", role: "alert" }, [error.message]));
    this.options.onFailure?.(error);
  }
}
