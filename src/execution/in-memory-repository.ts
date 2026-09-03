import { randomUUID } from "node:crypto";

import {
  appendAuditEvent,
  type AuditEvent,
  type AuditEventInput,
} from "../protocol/audit.js";
import { applyWarrantEvent } from "../protocol/state-machine.js";
import type { ExecutionRecord, IssuedWarrant } from "../protocol/schema.js";
import type { ReservationResult, WarrantRepository } from "./types.js";

export class InMemoryWarrantRepository implements WarrantRepository {
  readonly warrants = new Map<string, IssuedWarrant>();
  readonly executions = new Map<string, ExecutionRecord>();
  readonly auditChains = new Map<string, AuditEvent[]>();

  constructor(warrants: readonly IssuedWarrant[] = []) {
    for (const warrant of warrants) {
      this.warrants.set(
        warrant.authorization.warrant_id,
        structuredClone(warrant),
      );
    }
  }

  async getWarrant(warrantId: string): Promise<IssuedWarrant | undefined> {
    const warrant = this.warrants.get(warrantId);
    return warrant ? structuredClone(warrant) : undefined;
  }

  async saveWarrant(warrant: IssuedWarrant): Promise<IssuedWarrant> {
    const clone = structuredClone(warrant);
    this.warrants.set(warrant.authorization.warrant_id, clone);
    return structuredClone(clone);
  }

  async reserveExecution(input: {
    warrantId: string;
    expectedStateVersion: number;
    idempotencyKey: string;
    now: Date;
  }): Promise<ReservationResult> {
    const warrant = this.warrants.get(input.warrantId);
    if (!warrant) {
      throw new Error(`Unknown warrant ${input.warrantId}`);
    }

    if (warrant.execution_count > 0 || warrant.state === "EXECUTED") {
      return {
        ok: false,
        reason: "already_consumed",
        warrant: structuredClone(warrant),
      };
    }
    if (input.now.getTime() >= Date.parse(warrant.authorization.expires_at)) {
      return {
        ok: false,
        reason: "expired",
        warrant: structuredClone(warrant),
      };
    }
    if (warrant.state !== "AUTHORIZED") {
      return {
        ok: false,
        reason: "state_conflict",
        warrant: structuredClone(warrant),
      };
    }
    if (warrant.state_version !== input.expectedStateVersion) {
      return {
        ok: false,
        reason: "version_conflict",
        warrant: structuredClone(warrant),
      };
    }

    const reservedWarrant = applyWarrantEvent(warrant, "RESERVE_EXECUTION");
    const execution: ExecutionRecord = {
      id: randomUUID(),
      warrant_id: input.warrantId,
      idempotency_key: input.idempotencyKey,
      state: "RESERVED",
      requested_action: structuredClone(warrant.action),
      preflight_record: null,
      observed_record: null,
      error_code: null,
      started_at: input.now.toISOString(),
      completed_at: null,
    };

    this.warrants.set(input.warrantId, reservedWarrant);
    this.executions.set(execution.id, execution);
    return {
      ok: true,
      warrant: structuredClone(reservedWarrant),
      execution: structuredClone(execution),
    };
  }

  async setExecutionState(
    executionId: string,
    state: ExecutionRecord["state"],
    patch: Partial<
      Pick<
        ExecutionRecord,
        "completed_at" | "error_code" | "observed_record" | "preflight_record"
      >
    > = {},
  ): Promise<ExecutionRecord> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Unknown execution ${executionId}`);
    }

    const updated = { ...execution, ...structuredClone(patch), state };
    this.executions.set(executionId, updated);
    return structuredClone(updated);
  }

  async finishWarrant(
    warrantId: string,
    outcome: "EXECUTED" | "FAILED",
  ): Promise<IssuedWarrant> {
    const warrant = this.warrants.get(warrantId);
    if (!warrant) {
      throw new Error(`Unknown warrant ${warrantId}`);
    }

    const updated = applyWarrantEvent(
      warrant,
      outcome === "EXECUTED" ? "EXECUTION_VERIFIED" : "EXECUTION_FAILED",
    );
    this.warrants.set(warrantId, updated);
    return structuredClone(updated);
  }

  async appendAudit(input: AuditEventInput): Promise<AuditEvent> {
    const chain = this.auditChains.get(input.warrant_id) ?? [];
    const event = appendAuditEvent(chain, input);
    chain.push(event);
    this.auditChains.set(input.warrant_id, chain);
    return structuredClone(event);
  }

  async getAuditChain(warrantId: string): Promise<readonly AuditEvent[]> {
    return structuredClone(this.auditChains.get(warrantId) ?? []);
  }
}
