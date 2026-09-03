import type { DnsProvider } from "../src/execution/types.js";
import { executeWarrant } from "../src/execution/execute-warrant.js";
import { InMemoryWarrantRepository } from "../src/execution/in-memory-repository.js";
import { ProtocolError } from "../src/protocol/errors.js";
import type {
  DnsRecordAction,
  DnsRecordSnapshot,
} from "../src/protocol/schema.js";
import {
  createAuthorizedWarrant,
  demoPolicy,
  normalRecord,
} from "../src/testing/fixtures.js";

class SimulatedNameComProvider implements DnsProvider {
  private record = structuredClone(normalRecord);

  async getRecord(): Promise<DnsRecordSnapshot> {
    return structuredClone(this.record);
  }

  async updateRecord(action: DnsRecordAction): Promise<void> {
    this.record = structuredClone(action.effect);
  }
}

const warrant = createAuthorizedWarrant();
const repository = new InMemoryWarrantRepository([warrant]);
const provider = new SimulatedNameComProvider();
const now = new Date("2026-09-03T00:02:00Z");

console.log(
  "SIMULATION ONLY: Foxit signature and name.com are replaced by test adapters.\n",
);
console.log(
  JSON.stringify(
    {
      stage: "authorized_warrant",
      warrant_id: warrant.authorization.warrant_id,
      action_digest: warrant.authorization.action_digest,
      warrant_digest: warrant.warrant_digest,
      state: warrant.state,
      expires_at: warrant.authorization.expires_at,
    },
    null,
    2,
  ),
);

const result = await executeWarrant({
  warrantId: warrant.authorization.warrant_id,
  expectedStateVersion: warrant.state_version,
  idempotencyKey: "local-demo-execution",
  now,
  policy: demoPolicy,
  repository,
  provider,
});

console.log("\nFirst execution:\n", JSON.stringify(result, null, 2));

try {
  await executeWarrant({
    warrantId: warrant.authorization.warrant_id,
    expectedStateVersion: warrant.state_version,
    idempotencyKey: "local-demo-replay",
    now,
    policy: demoPolicy,
    repository,
    provider,
  });
  throw new Error("Replay unexpectedly succeeded");
} catch (error) {
  if (!(error instanceof ProtocolError)) throw error;
  console.log(
    "\nReplay attempt:\n",
    JSON.stringify(
      {
        blocked: true,
        code: error.code,
        message: error.message,
      },
      null,
      2,
    ),
  );
}
