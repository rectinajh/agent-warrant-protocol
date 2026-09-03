import type { AuditEvent, AuditEventInput } from "../protocol/audit.js";
import { appendAuditEvent } from "../protocol/audit.js";
import { sha256Hex } from "../protocol/digests.js";
import {
  executionRecordSchema,
  issuedWarrantSchema,
  type ExecutionRecord,
  type IssuedWarrant,
} from "../protocol/schema.js";
import type {
  ReservationResult,
  WarrantRepository,
} from "../execution/types.js";

export interface XanoRepositoryConfig {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}

/** REST client for the Xano workspace outlined in docs/XANO_WORKSPACE.md. */
export class XanoWarrantRepository implements WarrantRepository {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(config: XanoRepositoryConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.fetcher = config.fetch ?? globalThis.fetch;
  }

  private async request<T>(
    path: string,
    init: RequestInit,
  ): Promise<{ status: number; body: T | undefined }> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        ...init.headers,
      },
    });
    const text = await response.text();
    let body: T | undefined;
    if (text) {
      try {
        body = JSON.parse(text) as T;
      } catch {
        body = undefined;
      }
    }
    return { status: response.status, body };
  }

  async getWarrant(warrantId: string): Promise<IssuedWarrant | undefined> {
    const { status, body } = await this.request<IssuedWarrant>(
      `/warrants/${encodeURIComponent(warrantId)}`,
      { method: "GET" },
    );
    if (status === 404) {
      return undefined;
    }
    return issuedWarrantSchema.parse(body);
  }

  async saveWarrant(warrant: IssuedWarrant): Promise<IssuedWarrant> {
    const { body } = await this.request<IssuedWarrant>(`/warrants`, {
      method: "POST",
      body: JSON.stringify({
        id: warrant.authorization.warrant_id,
        state: warrant.state,
        state_version: warrant.state_version,
        execution_count: warrant.execution_count,
        action: warrant.action,
        authorization: warrant.authorization,
        action_digest: warrant.authorization.action_digest,
        warrant_digest: warrant.warrant_digest,
        nonce_sha256: sha256Hex(warrant.authorization.nonce),
        expires_at: warrant.authorization.expires_at,
      }),
    });
    if (!body) {
      throw new Error("Xano warrant save returned no body");
    }
    return issuedWarrantSchema.parse(body);
  }

  async listWarrants(): Promise<IssuedWarrant[]> {
    const { body } = await this.request<IssuedWarrant[]>(`/warrants`, {
      method: "GET",
    });
    return (body ?? []).map((warrant) => issuedWarrantSchema.parse(warrant));
  }

  async getExecution(
    executionId: string,
  ): Promise<ExecutionRecord | undefined> {
    const { status, body } = await this.request<ExecutionRecord>(
      `/executions/${encodeURIComponent(executionId)}`,
      { method: "GET" },
    );
    if (status === 404) {
      return undefined;
    }
    return executionRecordSchema.parse(body);
  }

  async listExecutions(): Promise<ExecutionRecord[]> {
    const { body } = await this.request<ExecutionRecord[]>(`/executions`, {
      method: "GET",
    });
    return (body ?? []).map((execution) =>
      executionRecordSchema.parse(execution),
    );
  }

  async reserveExecution(input: {
    warrantId: string;
    expectedStateVersion: number;
    idempotencyKey: string;
    now: Date;
  }): Promise<ReservationResult> {
    const { body } = await this.request<ReservationResult>(
      `/warrants/${encodeURIComponent(input.warrantId)}/reserve`,
      {
        method: "POST",
        body: JSON.stringify({
          expected_state_version: input.expectedStateVersion,
          idempotency_key: input.idempotencyKey,
          now: input.now.toISOString(),
        }),
      },
    );
    if (!body) {
      throw new Error("Xano reservation returned no body");
    }
    if (!body.ok) {
      return body;
    }
    return {
      ok: true,
      warrant: issuedWarrantSchema.parse(body.warrant),
      execution: executionRecordSchema.parse(body.execution),
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
    const { body } = await this.request<ExecutionRecord>(
      `/executions/${encodeURIComponent(executionId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          state,
          completed_at: patch.completed_at ?? null,
          error_code: patch.error_code ?? null,
          observed_record: patch.observed_record ?? null,
          preflight_record: patch.preflight_record ?? null,
        }),
      },
    );
    return executionRecordSchema.parse(body);
  }

  async finishWarrant(
    warrantId: string,
    outcome: "EXECUTED" | "FAILED",
  ): Promise<IssuedWarrant> {
    const { body } = await this.request<IssuedWarrant>(
      `/warrants/${encodeURIComponent(warrantId)}/finish`,
      {
        method: "POST",
        body: JSON.stringify({ outcome }),
      },
    );
    return issuedWarrantSchema.parse(body);
  }

  async appendAudit(input: AuditEventInput): Promise<AuditEvent> {
    const chain = await this.getAuditChain(input.warrant_id);
    const event = appendAuditEvent(chain, input);
    const { body } = await this.request<AuditEvent>(`/audit/events`, {
      method: "POST",
      body: JSON.stringify(event),
    });
    if (!body) {
      throw new Error("Xano audit append returned no body");
    }
    return body;
  }

  async getAuditChain(warrantId: string): Promise<readonly AuditEvent[]> {
    const { body } = await this.request<AuditEvent[]>(
      `/warrants/${encodeURIComponent(warrantId)}/audit`,
      { method: "GET" },
    );
    return body ?? [];
  }
}
