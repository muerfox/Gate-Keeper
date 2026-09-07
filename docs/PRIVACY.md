# Gate Keeper Privacy

Gate Keeper is privacy-by-design: it defaults to collecting the minimum
data needed to make a security decision, never builds a persistent
cross-site identity by default, and gives operators explicit, auditable
controls over every category of data below. This document is the
complete inventory — if a data category isn't listed here, Gate Keeper
does not collect it.

## Data categories

| Category | What it is | Default collected? | Retention | Configurable? |
|---|---|---|---|---|
| Challenge metadata | id, nonce, type, difficulty, site, action, timestamps | Yes (required for the security model to function) | Redis: challenge TTL (default 90s). Postgres audit row: indefinite unless pruned — see below. | TTL via site config |
| Interaction events | pointer/keyboard/focus/visibility events with **relative, monotonic timestamps** (never wall-clock) | Yes, but only for the duration of one verify call — not persisted to the database at all; used in-memory by the risk engine and then discarded | Not persisted | N/A — never written to durable storage in this implementation |
| Verification outcome | success/failure, outcome code, risk level, action, site | Yes | Postgres: indefinite unless pruned | `analyticsEnabled` toggle controls whether this feeds dashboard analytics; the row itself is written regardless (it's also the anti-replay/audit record) |
| Risk score signals | the *reasons* the risk engine flagged (e.g. `near_zero_pointer_timing_jitter`), not raw event dumps | Yes | Postgres: indefinite unless pruned | N/A |
| IP address | request-observed IP | **No, off by default** (`ipProcessingEnabled: false`) | If enabled: same as the record it's attached to | `ipProcessingEnabled` per site |
| Security events | rate-limit hits, replay detections, domain mismatches, admin login attempts | Yes (this is the audit trail security itself depends on) | Postgres: indefinite unless pruned | N/A |
| Admin credentials | scrypt password hash, encrypted-at-rest TOTP seed | Yes (admin plane requires authentication) | Until the account is deleted | N/A |
| Admin session tokens | sha256 hash of the session token (never the raw token) | Yes | 12 hours or until revoked | N/A |
| Audit log | which admin did what, when | Yes (accountability control) | Postgres: indefinite unless pruned | N/A |

## What Gate Keeper explicitly does NOT do

- **No persistent cross-site tracking identifier.** There is no cookie,
  fingerprint, or device ID that follows a visitor between unrelated
  sites or across verification sessions. Each challenge/token is
  scoped to one site and one action, with a short lifetime.
- **No browser fingerprinting by default**, and fingerprinting is never
  the primary or sole signal even where partial device signals are used
  — see `docs/THREAT_MODEL.md` §4.4 for why (spoofable, and a privacy
  cost with limited security benefit against a sophisticated attacker).
- **No raw behavioral event storage.** Interaction events exist only for
  the duration of a single verify call, in memory, and are reduced to a
  small set of named findings (e.g. "solve time below plausible minimum")
  before anything is written to the database. The raw mouse path/keys
  pressed are never persisted.
- **No IP geolocation.** IP address processing, when enabled, is used
  only as a coarse reputation signal (e.g. "known abusive range") — Gate
  Keeper does not compute or store city/region/precise location.
- **No sale or sharing of data with third parties.** Gate Keeper's data
  exists to make Gate Keeper's own risk decisions and to give the
  operator their own dashboard visibility into their own traffic.

## Retention and deletion

The reference implementation does not yet ship an automated retention/
pruning job — audit-relevant tables (`verification_attempts`,
`risk_events`, `security_events`, `challenges`, `audit_logs`) grow
indefinitely until an operator prunes them. This is called out explicitly
in `SECURITY_AUDIT.md` as a gap: production operators should run a
scheduled job (e.g. delete `verification_attempts` older than N days) sized
to their own compliance requirements (GDPR, CCPA, etc.), since Gate Keeper
does not currently do this automatically. `behavioralTelemetryTTLSeconds`
exists in the site configuration schema as the intended knob for this once
implemented.

## Anonymization

Because interaction events are never persisted and IP processing is
off by default, most of what Gate Keeper stores is already free of
directly-identifying data: a `verification_attempts` row is
`{siteId, action, outcome, riskLevel, requestIp?, timestamp}` — with
`requestIp` present only when the operator has explicitly opted in. If
you enable IP processing, treat that table as containing personal data
under your applicable privacy law and handle it accordingly (access
controls, retention limits, subject-access-request tooling — none of
which Gate Keeper currently automates).

## Configuration reference

Per-site privacy controls (`SiteConfig`, editable via the dashboard's
Settings page or `PATCH /api/v1/site/:id/config`):

- `ipProcessingEnabled` (default `false`) — whether request IPs are
  recorded and fed to the risk engine as a reputation signal.
- `analyticsEnabled` (default `true`) — whether verification outcomes
  feed the dashboard's aggregate analytics views.
- `behavioralTelemetryTTLSeconds` (default 7 days) — reserved for the
  retention job described above.

## Accountability

Every privileged admin action (site creation, key creation/revocation,
config changes) is written to `audit_logs` with the acting administrator's
id, action, target, and timestamp — visible to any `VIEWER`-or-above
administrator via the dashboard's Audit Logs page. Audit visibility is
itself a privacy/security control: it lets an organization detect
unauthorized access to its own Gate Keeper account.
