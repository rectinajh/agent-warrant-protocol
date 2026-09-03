import { randomBytes } from "node:crypto";

import { canonicalSha256, digestEquals, sha256Hex } from "./digests.js";
import { ProtocolError } from "./errors.js";
import {
  authorizationEnvelopeSchema,
  dnsRecordActionSchema,
  issuedWarrantSchema,
  type DnsRecordAction,
  type IssuedWarrant,
} from "./schema.js";

export interface CreateWarrantDraftInput {
  warrantId: string;
  agentId: string;
  signerEmail: string;
  reason: string;
  action: DnsRecordAction;
  issuedAt: Date;
  authorizationWindowSeconds?: number;
  nonce?: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createWarrantDraft(
  input: CreateWarrantDraftInput,
): IssuedWarrant {
  const action = dnsRecordActionSchema.parse(input.action);
  const authorizationWindowSeconds = input.authorizationWindowSeconds ?? 600;

  if (authorizationWindowSeconds < 60 || authorizationWindowSeconds > 900) {
    throw new RangeError(
      "Authorization window must be between 60 and 900 seconds",
    );
  }

  const issuedAt = input.issuedAt.toISOString();
  const expiresAt = new Date(
    input.issuedAt.getTime() + authorizationWindowSeconds * 1_000,
  ).toISOString();
  const actionDigest = canonicalSha256(action);

  const authorization = authorizationEnvelopeSchema.parse({
    version: "warrant.v1",
    warrant_id: input.warrantId,
    agent_id: input.agentId,
    action_digest: actionDigest,
    signer_email_hash: sha256Hex(normalizeEmail(input.signerEmail)),
    reason: input.reason,
    issued_at: issuedAt,
    not_before: issuedAt,
    expires_at: expiresAt,
    nonce: input.nonce ?? randomBytes(16).toString("base64url"),
    max_executions: 1,
  });

  return issuedWarrantSchema.parse({
    action,
    authorization,
    warrant_digest: canonicalSha256(authorization),
    state: "DRAFT",
    state_version: 0,
    execution_count: 0,
  });
}

export function assertWarrantIntegrity(warrant: IssuedWarrant): void {
  const parsed = issuedWarrantSchema.parse(warrant);
  const expectedActionDigest = canonicalSha256(parsed.action);

  if (!digestEquals(expectedActionDigest, parsed.authorization.action_digest)) {
    throw new ProtocolError(
      "ACTION_INTEGRITY_FAILED",
      "The frozen action no longer matches its signed digest",
    );
  }

  const expectedWarrantDigest = canonicalSha256(parsed.authorization);
  if (!digestEquals(expectedWarrantDigest, parsed.warrant_digest)) {
    throw new ProtocolError(
      "WARRANT_INTEGRITY_FAILED",
      "The authorization envelope no longer matches its warrant digest",
    );
  }
}
