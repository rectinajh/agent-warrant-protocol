import { describe, expect, it } from "vitest";

import type { DemoPolicy } from "../protocol/policy.js";
import { normalRecord } from "../testing/fixtures.js";
import { proposeDnsAction } from "./propose-action.js";

const policy: DemoPolicy = {
  domain: "sandbox-domain.example",
  recordId: 12_345,
  host: "status",
  recordType: "A",
  minTtl: 300,
  maxTtl: 3_600,
};

describe("proposeDnsAction", () => {
  it("builds a validated action from the model's JSON", async () => {
    const model = {
      chatJson: async () => ({
        answer: "192.0.2.11",
        ttl: 300,
        reason: "Emergency cutover",
      }),
    };

    const { action, reason } = await proposeDnsAction({
      request: "Point status at the emergency page",
      current: normalRecord,
      policy,
      model,
    });

    expect(reason).toBe("Emergency cutover");
    expect(action.effect.answer).toBe("192.0.2.11");
    expect(action.precondition).toEqual(normalRecord);
    expect(action.resource.record_id).toBe(12_345);
    expect(action.effect.host).toBe("status");
  });

  it("clamps ttl to the policy and falls back on the request for reason", async () => {
    const model = {
      chatJson: async () => ({ answer: "192.0.2.11", ttl: 999_999 }),
    };

    const { action, reason } = await proposeDnsAction({
      request: "Do the emergency thing",
      current: normalRecord,
      policy,
      model,
    });

    expect(action.effect.ttl).toBe(3_600);
    expect(reason).toContain("Do the emergency thing");
  });
});
