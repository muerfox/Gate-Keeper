// Dedicated entry point for the browser <script> / IIFE build only (see
// package.json's build script). Assigns to `window.GateKeeper` directly
// as a side effect rather than relying on esbuild's --global-name export
// unwrapping — that turned out to still wrap a lone `export default` in
// a `{ default: ... }` namespace object (verified against the actual
// built bundle), which would have left `GateKeeper.render` undefined in
// every script-tag consumer, this repo's own demo included.
import GateKeeper from "./index.js";

(globalThis as typeof globalThis & { GateKeeper: typeof GateKeeper }).GateKeeper = GateKeeper;
