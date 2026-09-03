import type {
  DnsRecordAction,
  DnsRecordSnapshot,
  IssuedWarrant,
} from "../protocol/schema.js";
import type { DemoPolicy } from "../protocol/policy.js";
import { applyWarrantEvent } from "../protocol/state-machine.js";
import { createWarrantDraft } from "../protocol/warrant.js";

export const normalRecord: DnsRecordSnapshot = {
  type: "A",
  host: "status",
  answer: "192.0.2.10",
  ttl: 300,
};

export const emergencyRecord: DnsRecordSnapshot = {
  type: "A",
  host: "status",
  answer: "192.0.2.11",
  ttl: 300,
};

export const demoAction: DnsRecordAction = {
  version: "action.v1",
  action_type: "dns.record.update",
  resource: {
    provider: "name.com",
    environment: "sandbox",
    domain: "sandbox-domain.example",
    record_id: 12_345,
  },
  precondition: normalRecord,
  effect: emergencyRecord,
};

export const demoPolicy: DemoPolicy = {
  domain: "sandbox-domain.example",
  recordId: 12_345,
  host: "status",
  recordType: "A",
  minTtl: 300,
  maxTtl: 3_600,
};

export function createAuthorizedWarrant(
  overrides: Partial<Parameters<typeof createWarrantDraft>[0]> = {},
): IssuedWarrant {
  const draft = createWarrantDraft({
    warrantId: "11111111-1111-4111-8111-111111111111",
    agentId: "demo-dns-agent",
    signerEmail: "operator@example.com",
    reason: "Emergency status-page cutover",
    action: demoAction,
    issuedAt: new Date("2026-09-03T00:00:00Z"),
    nonce: "abcdefghijklmnopqrstuv",
    ...overrides,
  });

  return applyWarrantEvent(
    applyWarrantEvent(draft, "ENVELOPE_CREATED"),
    "SIGNATURE_VERIFIED",
  );
}
