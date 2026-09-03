import { describe, expect, it } from "vitest";

import { ProtocolError } from "./errors.js";
import { assertActionAllowed, dnsRecordsEqual } from "./policy.js";
import { demoAction, demoPolicy, normalRecord } from "../testing/fixtures.js";

describe("demo policy", () => {
  it("accepts the exact allowlisted target", () => {
    expect(() => assertActionAllowed(demoAction, demoPolicy)).not.toThrow();
  });

  it("rejects a different record even on the same domain", () => {
    const action = structuredClone(demoAction);
    action.resource.record_id = 99_999;

    expect(() => assertActionAllowed(action, demoPolicy)).toThrowError(
      expect.objectContaining<Partial<ProtocolError>>({
        code: "TARGET_NOT_ALLOWED",
      }),
    );
  });

  it("normalizes DNS values for equality", () => {
    expect(
      dnsRecordsEqual(normalRecord, {
        ...normalRecord,
        answer: " 192.0.2.10 ",
      }),
    ).toBe(true);
  });
});
