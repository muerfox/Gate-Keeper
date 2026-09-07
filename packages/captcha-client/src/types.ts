import type { PublicChallenge, VerifyResult } from "@gatekeeper/shared";

export interface RenderOptions {
  siteKey: string;
  action: string;
  /** Base URL of the Gate Keeper API. Defaults to the hosted service;
   * self-hosted deployments point this at their own apps/api instance. */
  apiUrl?: string;
  /** Request the accessible challenge path up front (docs/ACCESSIBILITY.md)
   * — e.g. wire this to a "Having trouble? Use an accessible challenge"
   * link rather than trying to auto-detect assistive technology, which is
   * unreliable and itself a privacy concern. */
  accessible?: boolean;
  theme?: "light" | "dark" | "auto";
  onSuccess?: (token: string) => void;
  onFailure?: (error: GateKeeperError) => void;
  /** Fired whenever the widget needs to present a challenge to the user
   * (useful for layout/analytics; the widget still renders its own UI). */
  onChallenge?: (challenge: PublicChallenge) => void;
}

export interface ExecuteOptions extends RenderOptions {
  /** Optional container to render an interactive challenge into if one
   * turns out to be required. If omitted, execute() creates a temporary
   * modal overlay so invisible/programmatic flows (e.g. a login button
   * handler) still have somewhere to show a challenge when risk is not LOW. */
  container?: HTMLElement | string;
}

export class GateKeeperError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GateKeeperError";
  }
}

export interface ChallengeRenderer {
  /** Renders the challenge into `root` (a Shadow DOM subtree) and resolves
   * with the user's answer once they complete the interaction. Must emit
   * InteractionEvents via `collector` as the user interacts — this is what
   * feeds the server's behavioral consistency analysis (Layer 3). Rejects
   * only if the user explicitly cancels (e.g. requests a different
   * challenge type); a wrong answer is still submitted to the server,
   * which is the only party allowed to decide pass/fail. */
  render(root: HTMLElement, challenge: PublicChallenge, collector: EventCollectorHandle): Promise<unknown>;
}

export interface EventCollectorHandle {
  record(type: string, extra?: { x?: number; y?: number; key?: string }): void;
  drain(): import("@gatekeeper/shared").InteractionEvent[];
}

export type { PublicChallenge, VerifyResult };
