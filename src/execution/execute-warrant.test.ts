import { describe, expect, it } from "vitest";

import { AmbiguousProviderError } from "../protocol/errors.js";
import type { DnsRecordSnapshot } from "../protocol/schema.js";
import { verifyAuditChain } from "../protocol/audit.js";
import {
  createAuthorizedWarrant,
  demoPolicy,
  emergencyRecord,
  normalRecord,
} from "../testing/fixtures.js";
import { InMemoryWarrantRepository } from "./in-memory-repository.js";
import { executeWarrant } from "./execute-warrant.js";
import type { DnsProvider } from "./types.js";

class FakeDnsProvider implements DnsProvider {
  record: DnsRecordSnapshot;
  updateCount = 0;
  readonly ambiguous: boolean;
  readonly ignoreUpdate: boolean;

  constructor(
    record: DnsRecordSnapshot = normalRecord,
    options: { ambiguous?: boolean; ignoreUpdate?: boolean } = {},
  ) {
    this.record = structuredClone(record);
    this.ambiguous = options.ambiguous ?? false;
    this.ignoreUpdate = options.ignoreUpdate ?? false;
  }

  async getRecord(): Promise<DnsRecordSnapshot> {
    return structuredClone(this.record);
  }

  async updateRecord(
    action: Parameters<DnsProvider["updateRecord"]>[0],
  ): Promise<void> {
    this.updateCount += 1;
    if (this.ambiguous) {
      throw new AmbiguousProviderError("Network timeout after dispatch");
    }
    if (!this.ignoreUpdate) {
      this.record = structuredClone(action.effect);
    }
  }
}

function executionInput(
  repository: InMemoryWarrantRepository,
  provider: DnsProvider,
  idempotencyKey = "demo-execution-1",
) {
  return {
    warrantId: "11111111-1111-4111-8111-111111111111",
    expectedStateVersion: 2,
    idempotencyKey,
    now: new Date("2026-09-03T00:02:00Z"),
    policy: demoPolicy,
    repository,
    provider,
  } as const;
}

describe("executeWarrant", () => {
  it("executes once, verifies provider state, and emits a valid audit chain", async () => {
    const warrant = createAuthorizedWarrant();
    const repository = new InMemoryWarrantRepository([warrant]);
    const provider = new FakeDnsProvider();

    const result = await executeWarrant(executionInput(repository, provider));

    expect(result.status).toBe("executed");
    if (result.status !== "executed")
      throw new Error("Expected executed result");
    expect(result.receipt.execution.observed).toEqual(emergencyRecord);
    expect(provider.updateCount).toBe(1);
    expect(
      (await repository.getWarrant(warrant.authorization.warrant_id))?.state,
    ).toBe("EXECUTED");
    expect(
      verifyAuditChain(
        await repository.getAuditChain(warrant.authorization.warrant_id),
      ),
    ).toBe(true);

    await expect(
      executeWarrant(executionInput(repository, provider, "demo-execution-2")),
    ).rejects.toMatchObject({
      code: "WARRANT_ALREADY_CONSUMED",
    });
    expect(provider.updateCount).toBe(1);
  });

  it("allows only one concurrent reservation", async () => {
    const warrant = createAuthorizedWarrant();
    const repository = new InMemoryWarrantRepository([warrant]);
    const provider = new FakeDnsProvider();

    const results = await Promise.allSettled([
      executeWarrant(executionInput(repository, provider, "concurrent-a")),
      executeWarrant(executionInput(repository, provider, "concurrent-b")),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(provider.updateCount).toBe(1);
  });

  it("consumes the warrant without mutation when the precondition changed", async () => {
    const warrant = createAuthorizedWarrant();
    const repository = new InMemoryWarrantRepository([warrant]);
    const provider = new FakeDnsProvider({
      ...normalRecord,
      answer: "192.0.2.99",
    });

    await expect(
      executeWarrant(executionInput(repository, provider)),
    ).rejects.toMatchObject({
      code: "PRECONDITION_CHANGED",
    });
    expect(provider.updateCount).toBe(0);
    expect(
      (await repository.getWarrant(warrant.authorization.warrant_id))?.state,
    ).toBe("FAILED");
  });

  it("fails when the provider write does not produce the signed effect", async () => {
    const warrant = createAuthorizedWarrant();
    const repository = new InMemoryWarrantRepository([warrant]);
    const provider = new FakeDnsProvider(normalRecord, { ignoreUpdate: true });

    await expect(
      executeWarrant(executionInput(repository, provider)),
    ).rejects.toMatchObject({
      code: "POSTCONDITION_FAILED",
    });
    expect(provider.updateCount).toBe(1);
  });

  it("enters reconciliation instead of retrying an ambiguous mutation", async () => {
    const warrant = createAuthorizedWarrant();
    const repository = new InMemoryWarrantRepository([warrant]);
    const provider = new FakeDnsProvider(normalRecord, { ambiguous: true });

    const result = await executeWarrant(executionInput(repository, provider));

    expect(result.status).toBe("reconciling");
    if (result.status !== "reconciling")
      throw new Error("Expected reconciling result");
    expect(result.execution.state).toBe("RECONCILING");
    expect(provider.updateCount).toBe(1);
    expect(
      (await repository.getWarrant(warrant.authorization.warrant_id))?.state,
    ).toBe("EXECUTING");
  });
});
