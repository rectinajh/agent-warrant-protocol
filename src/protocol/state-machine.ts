import { ProtocolError } from "./errors.js";
import type { IssuedWarrant, WarrantState } from "./schema.js";

export type WarrantEvent =
  | "CANCEL"
  | "ENVELOPE_CREATED"
  | "EXECUTION_FAILED"
  | "EXECUTION_VERIFIED"
  | "EXPIRE"
  | "RESERVE_EXECUTION"
  | "SIGNATURE_DECLINED"
  | "SIGNATURE_VERIFIED";

const transitions: Readonly<
  Record<WarrantState, Partial<Record<WarrantEvent, WarrantState>>>
> = {
  DRAFT: {
    CANCEL: "CANCELLED",
    ENVELOPE_CREATED: "PENDING_SIGNATURE",
  },
  PENDING_SIGNATURE: {
    CANCEL: "CANCELLED",
    EXPIRE: "EXPIRED",
    SIGNATURE_DECLINED: "DECLINED",
    SIGNATURE_VERIFIED: "AUTHORIZED",
  },
  AUTHORIZED: {
    EXPIRE: "EXPIRED",
    RESERVE_EXECUTION: "EXECUTING",
  },
  EXECUTING: {
    EXECUTION_FAILED: "FAILED",
    EXECUTION_VERIFIED: "EXECUTED",
  },
  EXECUTED: {},
  FAILED: {},
  DECLINED: {},
  EXPIRED: {},
  CANCELLED: {},
};

export function nextWarrantState(
  state: WarrantState,
  event: WarrantEvent,
): WarrantState {
  const next = transitions[state][event];
  if (!next) {
    throw new ProtocolError(
      "INVALID_STATE_TRANSITION",
      `Cannot apply ${event} while warrant is ${state}`,
      { event, state },
    );
  }
  return next;
}

export function applyWarrantEvent(
  warrant: IssuedWarrant,
  event: WarrantEvent,
): IssuedWarrant {
  return {
    ...warrant,
    state: nextWarrantState(warrant.state, event),
    state_version: warrant.state_version + 1,
    execution_count:
      event === "RESERVE_EXECUTION"
        ? warrant.execution_count + 1
        : warrant.execution_count,
  };
}
