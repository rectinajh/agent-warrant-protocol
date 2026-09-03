import { describe, expect, it } from "vitest";

import { appendAuditEvent, verifyAuditChain } from "./audit.js";
import { ProtocolError } from "./errors.js";
import { applyWarrantEvent, nextWarrantState } from "./state-machine.js";
import { createAuthorizedWarrant } from "../testing/fixtures.js";

describe("warrant state machine", () => {
  it("permits the one-way execution path", () => {
    const authorized = createAuthorizedWarrant();
    const executing = applyWarrantEvent(authorized, "RESERVE_EXECUTION");
    const executed = applyWarrantEvent(executing, "EXECUTION_VERIFIED");

    expect(executing.execution_count).toBe(1);
    expect(executed.state).toBe("EXECUTED");
    expect(executed.state_version).toBe(4);
  });

  it("rejects terminal-state transitions", () => {
    expect(() =>
      nextWarrantState("EXECUTED", "RESERVE_EXECUTION"),
    ).toThrowError(
      expect.objectContaining<Partial<ProtocolError>>({
        code: "INVALID_STATE_TRANSITION",
      }),
    );
  });
});

describe("audit chain", () => {
  it("links events and detects tampering", () => {
    const first = appendAuditEvent([], {
      warrant_id: "11111111-1111-4111-8111-111111111111",
      event_type: "warrant.created",
      actor_kind: "system",
      actor_id: "issuer",
      before_state: null,
      after_state: "DRAFT",
      metadata: {},
      created_at: "2026-09-03T00:00:00.000Z",
    });
    const second = appendAuditEvent([first], {
      warrant_id: first.warrant_id,
      event_type: "warrant.authorized",
      actor_kind: "provider",
      actor_id: "foxit",
      before_state: "PENDING_SIGNATURE",
      after_state: "AUTHORIZED",
      metadata: { envelope_id: "env-demo" },
      created_at: "2026-09-03T00:01:00.000Z",
    });

    expect(verifyAuditChain([first, second])).toBe(true);
    expect(
      verifyAuditChain([first, { ...second, after_state: "EXECUTED" }]),
    ).toBe(false);
  });
});
