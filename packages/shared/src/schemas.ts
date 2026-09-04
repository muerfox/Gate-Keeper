import { z } from "zod";
import { MAX_INTERACTION_EVENTS } from "./constants.js";

/** Every schema here is deliberately strict (`.strict()`), bounded (`.max()`
 * on arrays/strings), and rejects unknown fields — the first line of defense
 * against oversized or malformed requests (docs/THREAT_MODEL.md §4.11/4.12). */

export const siteKeyPattern = /^[A-Za-z0-9_.:-]{8,128}$/;
export const actionPattern = /^[a-zA-Z0-9_.:-]{1,64}$/;

export const ChallengeRequestSchema = z
  .object({
    siteKey: z.string().regex(siteKeyPattern),
    action: z.string().regex(actionPattern),
    /** Optional hint from the client about a prior session, used only as a
     * weak risk-engine signal — never trusted as an identity claim. */
    sessionHint: z.string().max(128).optional(),
  })
  .strict();
export type ChallengeRequest = z.infer<typeof ChallengeRequestSchema>;

export const InteractionEventSchema = z
  .object({
    t: z.number().min(0).max(600_000),
    type: z.enum([
      "pointermove",
      "pointerdown",
      "pointerup",
      "keydown",
      "keyup",
      "focus",
      "blur",
      "visibilitychange",
      "drag",
      "drop",
    ]),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    key: z.string().max(32).optional(),
  })
  .strict();

export const VerifyRequestSchema = z
  .object({
    siteKey: z.string().regex(siteKeyPattern),
    action: z.string().regex(actionPattern),
    challengeId: z.string().min(1).max(64),
    signedEnvelope: z.string().min(1).max(4096),
    /** The challenge-type-specific answer payload; validated per-type inside
     * packages/challenges, never trusted at the transport layer. */
    answer: z.unknown(),
    events: z.array(InteractionEventSchema).max(MAX_INTERACTION_EVENTS).default([]),
  })
  .strict();
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

export const ServerVerifyRequestSchema = z
  .object({
    token: z.string().min(1).max(4096),
    action: z.string().regex(actionPattern),
  })
  .strict();
export type ServerVerifyRequest = z.infer<typeof ServerVerifyRequestSchema>;

export const ReportRequestSchema = z
  .object({
    siteKey: z.string().regex(siteKeyPattern),
    token: z.string().min(1).max(4096).optional(),
    reason: z.enum(["false_positive", "false_negative", "abuse_observed"]),
    detail: z.string().max(1000).optional(),
  })
  .strict();
export type ReportRequest = z.infer<typeof ReportRequestSchema>;

export const CreateSiteRequestSchema = z
  .object({
    name: z.string().min(1).max(128),
    domains: z.array(z.string().min(1).max(255)).max(50).default([]),
    environment: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("PRODUCTION"),
  })
  .strict();
export type CreateSiteRequest = z.infer<typeof CreateSiteRequestSchema>;

export const CreateApiKeyRequestSchema = z
  .object({
    siteId: z.string().min(1).max(64),
    type: z.enum(["PUBLIC_SITE_KEY", "SECRET_SERVER_KEY"]),
    environment: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("PRODUCTION"),
  })
  .strict();
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;
