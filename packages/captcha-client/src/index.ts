import { GateKeeperWidget } from "./widget.js";
import { installAutoInit } from "./auto-init.js";
import { GateKeeperError, type ExecuteOptions, type RenderOptions } from "./types.js";

function resolveContainer(target: HTMLElement | string): HTMLElement {
  if (typeof target !== "string") return target;
  const found = document.querySelector<HTMLElement>(target);
  if (!found) throw new GateKeeperError("container_not_found", `No element matches selector "${target}"`);
  return found;
}

/** `GateKeeper.render("#gatekeeper", { siteKey, action, onSuccess, onFailure })` */
function render(target: HTMLElement | string, options: RenderOptions): GateKeeperWidget {
  const container = resolveContainer(target);
  const widget = new GateKeeperWidget(container, options);
  void widget.run();
  return widget;
}

/**
 * `const token = await GateKeeper.execute({ siteKey, action })`
 *
 * For programmatic (non-widget) flows, e.g. a login button's click handler.
 * If a `container` is supplied it's used as-is; otherwise a temporary modal
 * overlay is created so a MEDIUM/HIGH risk session still has somewhere to
 * show an interactive challenge — a LOW-risk session typically resolves via
 * an invisible/computational challenge and the overlay is removed almost
 * immediately.
 */
function execute(options: ExecuteOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const { container: providedContainer, ...rest } = options;
    const ownsContainer = !providedContainer;
    const container = providedContainer ? resolveContainer(providedContainer) : createOverlay();

    const cleanup = () => {
      if (ownsContainer) container.remove();
    };

    const widget = new GateKeeperWidget(container, {
      ...rest,
      onSuccess(token) {
        options.onSuccess?.(token);
        setTimeout(cleanup, ownsContainer ? 400 : 0);
        resolve(token);
      },
      onFailure(error) {
        options.onFailure?.(error);
        setTimeout(cleanup, ownsContainer ? 1200 : 0);
        reject(error);
      },
    });
    void widget.run();
  });
}

function createOverlay(): HTMLElement {
  const backdrop = document.createElement("div");
  backdrop.setAttribute("data-gatekeeper-overlay", "");
  Object.assign(backdrop.style, {
    position: "fixed",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(4, 8, 16, 0.6)",
    zIndex: "2147483647",
  });
  document.body.append(backdrop);
  return backdrop;
}

installAutoInit();

export const GateKeeper = { render, execute };
export type { RenderOptions, ExecuteOptions };
export { GateKeeperError };
export default GateKeeper;
