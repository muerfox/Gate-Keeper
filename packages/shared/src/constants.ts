/** Shared, security-relevant defaults. Every value here is admin-overridable
 * per site via SiteConfig — these are the safe defaults, not hard limits. */

export const DEFAULT_CHALLENGE_TTL_SECONDS = 90;
export const DEFAULT_TOKEN_TTL_SECONDS = 120;
export const MAX_CHALLENGE_TTL_SECONDS = 300;
export const MAX_TOKEN_TTL_SECONDS = 300;

/** Hard cap on request bodies for every Gate Keeper API endpoint. Applied
 * before any parsing/crypto work (see docs/THREAT_MODEL.md §4.11). */
export const MAX_REQUEST_BODY_BYTES = 32 * 1024; // 32 KiB

/** Behavioral event arrays (pointer/keyboard/focus) are capped so a single
 * verify call cannot be used to smuggle unbounded data or exhaust memory. */
export const MAX_INTERACTION_EVENTS = 500;

export const SITE_KEY_PREFIX_PUBLIC = "gk_pub_";
export const SITE_KEY_PREFIX_SECRET = "gk_secret_";
export const SITE_KEY_PREFIX_DEV = "gk_dev_";

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
