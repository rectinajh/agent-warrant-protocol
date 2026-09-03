import { z } from "zod";

export const sha256HexSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 hex digest");

/**
 * Xano returns timestamps as epoch milliseconds, while the protocol stores them as
 * UTC ISO-8601 strings. Normalize both forms here so callers always see ISO strings.
 * A value of `0` means "not set" (Xano's encoding of null for a non-nullable column)
 * and is turned into `null`.
 */
export const isoTimestampSchema = z.union([
  z.iso.datetime({ offset: true }),
  z
    .number()
    .int()
    .transform((epochMs) => new Date(epochMs).toISOString()),
]);

export const dnsRecordTypeSchema = z.enum(["A", "AAAA", "CNAME", "TXT"]);

export const dnsRecordSnapshotSchema = z
  .object({
    type: dnsRecordTypeSchema,
    host: z.string().min(1).max(253),
    answer: z.string().min(1).max(2048),
    ttl: z.number().int().min(300).max(86_400),
  })
  .strict();

export const dnsRecordActionSchema = z
  .object({
    version: z.literal("action.v1"),
    action_type: z.literal("dns.record.update"),
    resource: z
      .object({
        provider: z.literal("name.com"),
        environment: z.literal("sandbox"),
        domain: z.string().min(1).max(253),
        record_id: z.number().int().positive(),
      })
      .strict(),
    precondition: dnsRecordSnapshotSchema,
    effect: dnsRecordSnapshotSchema,
  })
  .strict();

export type DnsRecordSnapshot = z.infer<typeof dnsRecordSnapshotSchema>;
export type DnsRecordAction = z.infer<typeof dnsRecordActionSchema>;

export const authorizationEnvelopeSchema = z
  .object({
    version: z.literal("warrant.v1"),
    warrant_id: z.uuid(),
    agent_id: z.string().min(1).max(128),
    action_digest: sha256HexSchema,
    signer_email_hash: sha256HexSchema,
    reason: z.string().min(1).max(500),
    issued_at: isoTimestampSchema,
    not_before: isoTimestampSchema,
    expires_at: isoTimestampSchema,
    nonce: z
      .string()
      .regex(/^[A-Za-z0-9_-]{22,}$/, "Expected a base64url nonce"),
    max_executions: z.literal(1),
  })
  .strict();

export type AuthorizationEnvelope = z.infer<typeof authorizationEnvelopeSchema>;

export const warrantStateSchema = z.enum([
  "DRAFT",
  "PENDING_SIGNATURE",
  "AUTHORIZED",
  "EXECUTING",
  "EXECUTED",
  "FAILED",
  "DECLINED",
  "EXPIRED",
  "CANCELLED",
]);

export type WarrantState = z.infer<typeof warrantStateSchema>;

export const issuedWarrantSchema = z
  .object({
    action: dnsRecordActionSchema,
    authorization: authorizationEnvelopeSchema,
    warrant_digest: sha256HexSchema,
    state: warrantStateSchema,
    state_version: z.number().int().nonnegative(),
    execution_count: z.number().int().min(0).max(1),
  })
  .strict();

export type IssuedWarrant = z.infer<typeof issuedWarrantSchema>;

export const executionStateSchema = z.enum([
  "NOT_STARTED",
  "RESERVED",
  "PROVIDER_ACCEPTED",
  "RECONCILING",
  "VERIFIED",
  "FAILED",
]);

export type ExecutionState = z.infer<typeof executionStateSchema>;

export const executionRecordSchema = z
  .object({
    id: z.uuid(),
    warrant_id: z.uuid(),
    idempotency_key: z.string().min(1).max(256),
    state: executionStateSchema,
    requested_action: dnsRecordActionSchema,
    preflight_record: dnsRecordSnapshotSchema.nullable(),
    observed_record: dnsRecordSnapshotSchema.nullable(),
    error_code: z.string().nullable(),
    started_at: isoTimestampSchema,
    completed_at: isoTimestampSchema.nullable(),
  })
  .strict();

export type ExecutionRecord = z.infer<typeof executionRecordSchema>;
