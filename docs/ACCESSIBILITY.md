# Gate Keeper Accessibility

Gate Keeper is designed so that no visitor is locked out of the sites it
protects because of a disability. This is treated as a first-class
requirement, not a bolted-on fallback — see the design principle below
before the checklist.

## Design principle

A CAPTCHA that gets visually more complex to defeat AI solvers almost
always gets *worse* for accessibility, while modern AI models often solve
those harder visual puzzles anyway. Gate Keeper's security instead comes
from combining independent layers (cryptographic verification, rate
limiting, behavioral analysis, adaptive escalation — see
`docs/ARCHITECTURE.md`), which means the *puzzle itself* never has to be
the primary line of defense. That frees challenge design to prioritize
accessibility without trading away security.

## What "accessible" means for a Gate Keeper challenge

A challenge type is only added to the accessible pool
(`packages/challenges`' `accessible: true` flag, exposed via
`ACCESSIBLE_CHALLENGE_TYPES`) if it depends on **none** of:

- Vision (no challenge requires seeing an image/shape/color to solve it)
- Hearing (no audio-only challenge exists or is planned)
- Fine motor pointer control (no challenge requires precise
  dragging/clicking within a small target)
- Reaction speed (no challenge has a pass/fail time window under normal
  human reading/typing speed)

Concretely, the accessible pool today is: `accessible_alternative` (a
plain-language, keyboard/screen-reader-first question rendered as a
native `<select>`), and the two computational types (`proof_of_work`,
`cryptographic_proof`), which require **no interaction at all** — the
browser computes a bounded background task and the visitor sees only a
brief "Verifying…" status. When an accessible session's risk profile
allows a computational challenge, that's the best possible outcome:
zero interactive burden.

## Requesting the accessible path

Integrators should surface an explicit opt-in — e.g., a "Trouble
completing this? Use an accessible challenge" link — rather than trying
to auto-detect assistive technology, which is unreliable and itself a
privacy concern (see `docs/PRIVACY.md`: no fingerprinting).

- JS SDK: `GateKeeper.render(el, { siteKey, action, accessible: true })`
- HTML widget: `<div data-gatekeeper data-accessible="true" ...>`
- Offline SDK: `gatekeeper.issue(action, { accessible: true })`

## Keyboard operability

Every interactive renderer in `packages/captcha-client/src/renderers/`
is fully keyboard-operable:

- **Tile selection** (`visual_object_selection`, `image_classification`):
  native `<button>` elements, `Tab`-focusable, `Enter`/`Space`-activatable,
  with `aria-pressed` reflecting selection state.
- **Single-select** (`spatial_reasoning`, `pattern_recognition`): same
  button-based pattern.
- **Sequence recognition**: palette buttons are disabled during playback
  and keyboard-activatable during input.
- **Drag and drop**: supports native pointer drag AND a "select item, then
  select target" click/keyboard-activatable alternative — a pure
  drag-and-drop implementation has no keyboard equivalent and would fail
  WCAG 2.1 SC 2.1.1 (Keyboard) on its own.
- **Rotation**: a native `<input type="range">`, which is keyboard-
  operable (arrow keys) without any custom code.
- **Dynamic interaction** (press-and-hold): responds to both
  `pointerdown`/`pointerup` and `keydown`/`keyup` (Space or Enter).
- **Accessible alternative**: a native `<select>` — the most reliably
  screen-reader- and keyboard-compatible pattern available, deliberately
  chosen over a custom ARIA listbox reimplementation.

## Screen reader support

- The widget's root region has `role="region"` and an
  `aria-label="Gate Keeper verification"`.
- Status changes (loading, verifying, success, error) are announced via
  `role="status"` / `role="alert"` live regions.
- Every renderer's instruction text is rendered as visible, readable
  content — not conveyed through color, icon, or image alone.
- The accessible-alternative renderer's `<select>` has an explicit
  `<label>` wired via `aria-labelledby`.

## Visual design

- **High contrast**: the widget's dark navy background (`#0b1220`) against
  light text (`#e6ecf7`) and an electric-blue accent (`#3b82f6`) meets
  WCAG AA contrast ratios for normal text.
- **Focus indicators**: every interactive element gets a visible
  `outline` on `:focus-visible` (2px solid accent color, 2px offset) —
  never `outline: none` without a replacement.
- **Reduced motion**: the loading spinner's animation is disabled under
  `prefers-reduced-motion: reduce`. No renderer relies on motion to convey
  information that isn't also stated in text.
- **Light/dark theme**: `theme: "light" | "dark" | "auto"` is supported;
  `"auto"` follows the host page's context via the `data-theme` attribute
  path documented in the widget's CSS.

## Localization

Challenge instruction strings are currently English-only in this
reference implementation (e.g. `"Select every ${color} ${shape}."`).
Localizing them is a matter of externalizing these strings in
`packages/challenges/src/generators/*.ts` and `packages/captcha-client/
src/renderers/*.ts` into a translation layer — not implemented here, and
called out as a gap in `SECURITY_AUDIT.md`. The `accessible_alternative`
generator's word lists (`packages/challenges/src/generators/
accessible-alternative.ts`) would need translated word sets per locale to
remain solvable.

## Mobile accessibility

- All interactive targets (buttons, the range input, the select) use
  standard HTML form controls, which inherit the platform's native touch
  target sizing and assistive-technology support (VoiceOver, TalkBack)
  rather than a custom canvas/SVG-only interaction surface.
- The widget's layout is a single responsive column (`max-width: 360px`)
  that reflows naturally in a mobile viewport; no fixed pixel positioning
  that would break at small screen sizes.

## Known limitations

- No audio channel exists for challenges (no audio CAPTCHA alternative is
  offered) — the accessible path relies on text/keyboard interaction
  instead, which also serves users with hearing impairments without
  needing a separate audio-specific challenge.
- Localization (above) is not implemented.
- The demo app (`apps/demo`) and dashboard (`apps/dashboard`) have not
  been through a full manual screen-reader audit (NVDA/JAWS/VoiceOver) in
  this pass — the widget itself (the component actually exposed to end
  users of protected sites) is the piece held to the standard described
  above; the admin-facing dashboard is a standard React app using native
  form elements and semantic HTML, but hasn't been separately audited.

## Testing recommendations for integrators

- Tab through the widget with a keyboard only — confirm every action
  (select, submit, drag alternative, hold) is reachable and operable.
- Test with a screen reader (VoiceOver, NVDA) to confirm instructions and
  status changes are announced.
- Test with `prefers-reduced-motion` enabled.
- Test the accessible path (`accessible: true`) explicitly, not just the
  default path.
