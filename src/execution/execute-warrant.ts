import { randomUUID } from "node:crypto";

import { ProtocolError, AmbiguousProviderError } from "../protocol/errors.js";
import {
  assertActionAllowed,
  assertDnsPostcondition,
  assertDnsPrecondition,
  assertWarrantActiveForExecution,
  type DemoPolicy,
} from "../protocol/policy.js";
import type { ExecutionRecord } from "../protocol/schema.js";
import type {
  DnsProvider,
  ExecuteWarrantResult,
  ExecutionReceipt,
  WarrantRepository,
} from "./types.js";

export interface ExecuteWarrantInput {
  warrantId: string;
  expectedStateVersion: number;
  idempotencyKey: string;
  now: Date;
  policy: DemoPolicy;
  repository: WarrantRepository;
  provider: DnsProvider;
}

function reservationError(
  reason:
    "already_consumed" | "expired" | "state_conflict" | "version_conflict",
) {
  switch (reason) {
    case "already_consumed":
      return new ProtocolError(
        "WARRANT_ALREADY_CONSUMED",
        "The warrant has already consumed its single permitted execution",
      );
    case "expired":
      return new ProtocolError(
        "WARRANT_EXPIRED",
        "The warrant expired before reservation",
      );
    case "state_conflict":
      return new ProtocolError(
        "EXECUTION_IN_PROGRESS",
        "The warrant is not available for execution",
      );
    case "version_conflict":
      return new ProtocolError(
        "EXECUTION_IN_PROGRESS",
        "The warrant changed before this request could reserve it",
      );
  }
}

async function recordFailure(
  repository: WarrantRepository,
  execution: ExecutionRecord,
  error: ProtocolError,
  now: Date,
): Promise<void> {
  await repository.setExecutionState(execution.id, "FAILED", {
    completed_at: now.toISOString(),
    error_code: error.code,
  });
  await repository.finishWarrant(execution.warrant_id, "FAILED");
  await repository.appendAudit({
    warrant_id: execution.warrant_id,
    event_type: "execution.failed",
    actor_kind: "system",
    actor_id: "warrant-executor",
    before_state: "EXECUTING",
    after_state: "FAILED",
    metadata: { error_code: error.code },
    created_at: now.toISOString(),
  });
}

export async function executeWarrant(
  input: ExecuteWarrantInput,
): Promise<ExecuteWarrantResult> {
  const reservation = await input.repository.reserveExecution({
    warrantId: input.warrantId,
    expectedStateVersion: input.expectedStateVersion,
    idempotencyKey: input.idempotencyKey,
    now: input.now,
  });

  if (!reservation.ok) {
    throw reservationError(reservation.reason);
  }

  const { execution, warrant } = reservation;
  await input.repository.appendAudit({
    warrant_id: input.warrantId,
    event_type: "execution.reserved",
    actor_kind: "system",
    actor_id: "warrant-executor",
    before_state: "AUTHORIZED",
    after_state: "EXECUTING",
    metadata: { execution_id: execution.id },
    created_at: input.now.toISOString(),
  });

  try {
    assertWarrantActiveForExecution(warrant, input.now);
    assertActionAllowed(warrant.action, input.policy);

    const current = await input.provider.getRecord(
      warrant.action.resource.domain,
      warrant.action.resource.record_id,
    );
    await input.repository.setExecutionState(execution.id, "RESERVED", {
      preflight_record: current,
    });
    assertDnsPrecondition(warrant.action, current);

    try {
      await input.provider.updateRecord(warrant.action);
    } catch (error) {
      if (error instanceof AmbiguousProviderError) {
        const reconciling = await input.repository.setExecutionState(
          execution.id,
          "RECONCILING",
          { error_code: error.code },
        );
        await input.repository.appendAudit({
          warrant_id: input.warrantId,
          event_type: "execution.reconciling",
          actor_kind: "provider",
          actor_id: "name.com",
          before_state: "RESERVED",
          after_state: "RECONCILING",
          metadata: { error_code: error.code },
          created_at: input.now.toISOString(),
        });
        return { status: "reconciling", execution: reconciling };
      }
      throw error;
    }

    await input.repository.setExecutionState(execution.id, "PROVIDER_ACCEPTED");
    const observed = await input.provider.getRecord(
      warrant.action.resource.domain,
      warrant.action.resource.record_id,
    );
    assertDnsPostcondition(warrant.action, observed);

    const completedAt = input.now.toISOString();
    await input.repository.setExecutionState(execution.id, "VERIFIED", {
      completed_at: completedAt,
      observed_record: observed,
    });
    await input.repository.finishWarrant(input.warrantId, "EXECUTED");
    const finalEvent = await input.repository.appendAudit({
      warrant_id: input.warrantId,
      event_type: "execution.verified",
      actor_kind: "provider",
      actor_id: "name.com",
      before_state: "EXECUTING",
      after_state: "EXECUTED",
      metadata: { execution_id: execution.id },
      created_at: completedAt,
    });

    const receipt: ExecutionReceipt = {
      version: "receipt.v1",
      receipt_id: randomUUID(),
      warrant_id: input.warrantId,
      action_digest: warrant.authorization.action_digest,
      warrant_digest: warrant.warrant_digest,
      signer_email_hash: warrant.authorization.signer_email_hash,
      execution: {
        requested: warrant.action,
        observed,
        verified_at: completedAt,
      },
      event_chain_head: finalEvent.event_hash,
      created_at: completedAt,
    };

    return { status: "executed", receipt };
  } catch (error) {
    const protocolError =
      error instanceof ProtocolError
        ? error
        : new ProtocolError(
            "PROVIDER_REJECTED",
            "The execution provider rejected the action",
          );
    await recordFailure(input.repository, execution, protocolError, input.now);
    throw protocolError;
  }
}
