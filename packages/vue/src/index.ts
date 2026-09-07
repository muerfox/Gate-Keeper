import { defineComponent, h, onMounted, onBeforeUnmount, ref, watch, type PropType } from "vue";
import { GateKeeper, type ExecuteOptions, type RenderOptions, type GateKeeperError } from "@gatekeeper/captcha-client";

export type { RenderOptions, ExecuteOptions, GateKeeperError };

/**
 * <GateKeeperCaptcha site-key="GK_PUBLIC_KEY" action="signup"
 *   @success="onSuccess" @failure="onFailure" />
 *
 * Thin wrapper, same shape as the React component: mounts the vanilla
 * widget into an internal div and re-mounts on siteKey/action change. All
 * verification logic lives in @gatekeeper/captcha-client.
 */
export const GateKeeperCaptcha = defineComponent({
  name: "GateKeeperCaptcha",
  props: {
    siteKey: { type: String, required: true },
    action: { type: String, required: true },
    apiUrl: { type: String as PropType<string | undefined>, default: undefined },
    accessible: { type: Boolean, default: undefined },
    theme: { type: String as PropType<RenderOptions["theme"]>, default: undefined },
  },
  emits: {
    success: (_token: string) => true,
    failure: (_error: GateKeeperError) => true,
  },
  setup(props, { emit }) {
    const containerRef = ref<HTMLDivElement | null>(null);

    function mount() {
      const container = containerRef.value;
      if (!container) return;
      container.replaceChildren();
      const host = document.createElement("div");
      container.append(host);
      GateKeeper.render(host, {
        siteKey: props.siteKey,
        action: props.action,
        apiUrl: props.apiUrl,
        accessible: props.accessible,
        theme: props.theme,
        onSuccess: (token) => emit("success", token),
        onFailure: (error) => emit("failure", error),
      });
    }

    onMounted(mount);
    watch(() => [props.siteKey, props.action, props.apiUrl, props.accessible, props.theme], mount);
    onBeforeUnmount(() => containerRef.value?.replaceChildren());

    return () => h("div", { ref: containerRef });
  },
});

/** useGateKeeper() — Vue composable for imperative flows, mirroring the
 * React hook of the same name. */
export function useGateKeeper() {
  function execute(options: ExecuteOptions) {
    return GateKeeper.execute(options);
  }
  return { execute };
}
