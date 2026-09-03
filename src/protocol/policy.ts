import { canonicalize } from "./canonical.js";
import { ProtocolError } from "./errors.js";
import type {
  DnsRecordAction,
  DnsRecordSnapshot,
  IssuedWarrant,
} from "./schema.js";
import { assertWarrantIntegrity } from "./warrant.js";

export interface DemoPolicy {
  domain: string;
  recordId: number;
  host: string;
  recordType: DnsRecordSnapshot["type"];
  minTtl: number;
  maxTtl: number;
}

function normalizeDnsName(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.endsWith(".") ? normalized : `${normalized}.`;
}

export function normalizeDnsRecord(
  record: DnsRecordSnapshot,
): DnsRecordSnapshot {
  return {
    ...record,
    host: record.host.trim().toLowerCase(),
    answer:
      record.type === "CNAME"
        ? normalizeDnsName(record.answer)
        : record.answer.trim(),
  };
}

export function dnsRecordsEqual(
  left: DnsRecordSnapshot,
  right: DnsRecordSnapshot,
): boolean {
  return (
    canonicalize(normalizeDnsRecord(left)) ===
    canonicalize(normalizeDnsRecord(right))
  );
}

export function assertActionAllowed(
  action: DnsRecordAction,
  policy: DemoPolicy,
): void {
  const matchesTarget =
    action.action_type === "dns.record.update" &&
    action.resource.provider === "name.com" &&
    action.resource.environment === "sandbox" &&
    action.resource.domain.toLowerCase() === policy.domain.toLowerCase() &&
    action.resource.record_id === policy.recordId &&
    action.precondition.host.toLowerCase() === policy.host.toLowerCase() &&
    action.effect.host.toLowerCase() === policy.host.toLowerCase() &&
    action.precondition.type === policy.recordType &&
    action.effect.type === policy.recordType;

  const ttlAllowed =
    action.effect.ttl >= policy.minTtl && action.effect.ttl <= policy.maxTtl;

  if (!matchesTarget || !ttlAllowed) {
    throw new ProtocolError(
      "TARGET_NOT_ALLOWED",
      "The requested DNS action is outside the configured demo policy",
      {
        action_type: action.action_type,
        domain: action.resource.domain,
        record_id: action.resource.record_id,
      },
    );
  }
}

export function assertWarrantActiveForExecution(
  warrant: IssuedWarrant,
  now: Date,
): void {
  assertWarrantIntegrity(warrant);

  if (warrant.state !== "EXECUTING") {
    throw new ProtocolError(
      "WARRANT_NOT_ACTIVE",
      `Expected an atomically reserved warrant, received ${warrant.state}`,
    );
  }

  const timestamp = now.getTime();
  if (
    timestamp < Date.parse(warrant.authorization.not_before) ||
    timestamp >= Date.parse(warrant.authorization.expires_at)
  ) {
    throw new ProtocolError(
      "WARRANT_EXPIRED",
      "The warrant is outside its execution window",
    );
  }
}

export function assertDnsPrecondition(
  action: DnsRecordAction,
  current: DnsRecordSnapshot,
): void {
  if (!dnsRecordsEqual(action.precondition, current)) {
    throw new ProtocolError(
      "PRECONDITION_CHANGED",
      "The live DNS record no longer matches the signed precondition",
      { current, signed_precondition: action.precondition },
    );
  }
}

export function assertDnsPostcondition(
  action: DnsRecordAction,
  observed: DnsRecordSnapshot,
): void {
  if (!dnsRecordsEqual(action.effect, observed)) {
    throw new ProtocolError(
      "POSTCONDITION_FAILED",
      "The observed DNS record does not match the signed effect",
      { observed, signed_effect: action.effect },
    );
  }
}
