import type {
  DnsRecordAction,
  DnsRecordSnapshot,
  ExecutionRecord,
  IssuedWarrant,
} from "../protocol/schema.js";
import type { AuditEvent, AuditEventInput } from "../protocol/audit.js";

export interface DnsProvider {
  getRecord(domain: string, recordId: number): Promise<DnsRecordSnapshot>;
  updateRecord(action: DnsRecordAction): Promise<void>;
}

export type ReservationResult =
  | { ok: true; warrant: IssuedWarrant; execution: ExecutionRecord }
  | {
      ok: false;
      reason:
        "already_consumed" | "expired" | "state_conflict" | "version_conflict";
      warrant: IssuedWarrant;
    };

export interface WarrantRepository {
  getWarrant(warrantId: string): Promise<IssuedWarrant | undefined>;
  saveWarrant(warrant: IssuedWarrant): Promise<IssuedWarrant>;
  reserveExecution(input: {
    warrantId: string;
    expectedStateVersion: number;
    idempotencyKey: string;
    now: Date;
  }): Promise<ReservationResult>;
  setExecutionState(
    executionId: string,
    state: ExecutionRecord["state"],
    patch?: Partial<
      Pick<
        ExecutionRecord,
        "completed_at" | "error_code" | "observed_record" | "preflight_record"
      >
    >,
  ): Promise<ExecutionRecord>;
  finishWarrant(
    warrantId: string,
    outcome: "EXECUTED" | "FAILED",
  ): Promise<IssuedWarrant>;
  appendAudit(input: AuditEventInput): Promise<AuditEvent>;
  getAuditChain(warrantId: string): Promise<readonly AuditEvent[]>;
}

export interface ExecutionReceipt {
  version: "receipt.v1";
  receipt_id: string;
  warrant_id: string;
  action_digest: string;
  warrant_digest: string;
  signer_email_hash: string;
  execution: {
    requested: DnsRecordAction;
    observed: DnsRecordSnapshot;
    verified_at: string;
  };
  event_chain_head: string;
  created_at: string;
}

export type ExecuteWarrantResult =
  | { status: "executed"; receipt: ExecutionReceipt }
  | { status: "reconciling"; execution: ExecutionRecord };
