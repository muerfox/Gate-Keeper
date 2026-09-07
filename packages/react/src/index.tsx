import { useEffect, useRef, useCallback } from "react";
import { GateKeeper, type ExecuteOptions, type RenderOptions, type GateKeeperError } from "@gatekeeper/captcha-client";

export type { RenderOptions, ExecuteOptions, GateKeeperError };

export interface GateKeeperCaptchaProps extends Omit<RenderOptions, "onSuccess" | "onFailure"> {
  onSuccess?: (token: string) => void;
  onFailure?: (error: GateKeeperError) => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * <GateKeeperCaptcha siteKey="GK_PUBLIC_KEY" action="signup" onSuccess={...} />
 *
 * Thin wrapper around the vanilla widget: mounts it into a div on first
 * render and re-mounts if `siteKey`/`action` change. All verification
 * logic lives in @gatekeeper/captcha-client — this component only manages
 * the DOM container's lifecycle within React.
 */
export function GateKeeperCaptcha(props: GateKeeperCaptchaProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const { siteKey, action, apiUrl, accessible, theme, onSuccess, onFailure, className, style } = props;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // A widget attaches a Shadow Root once per host element; on
    // re-render/re-mount we need a clean host node.
    container.replaceChildren();
    const host = document.createElement("div");
    container.append(host);

    GateKeeper.render(host, { siteKey, action, apiUrl, accessible, theme, onSuccess, onFailure });

    return () => {
      container.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, action, apiUrl, accessible, theme]);

  return <div ref={containerRef} className={className} style={style} />;
}

/**
 * useGateKeeper() — for imperative flows (a login form's submit handler,
 * etc.) rather than an always-visible widget:
 *
 *   const { execute } = useGateKeeper();
 *   const token = await execute({ siteKey, action: "login" });
 */
export function useGateKeeper() {
  const execute = useCallback((options: ExecuteOptions) => GateKeeper.execute(options), []);
  return { execute };
}
