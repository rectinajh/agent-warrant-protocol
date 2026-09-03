import { describe, expect, it, vi } from "vitest";

import { createAuthorizedWarrant } from "../testing/fixtures.js";
import { XanoWarrantRepository } from "./xano-repository.js";

const authorized = createAuthorizedWarrant();
const execution = {
  id: "22222222-2222-4222-8222-222222222222",
  warrant_id: authorized.authorization.warrant_id,
  idempotency_key: "demo-execution-1",
  state: "RESERVED",
  requested_action: authorized.action,
  preflight_record: null,
  observed_record: null,
  error_code: null,
  started_at: "2026-09-03T00:02:00.000Z",
  completed_at: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const config = {
  baseUrl: "https://xcq6-dnqz-j5vz.n7e.xano.io/api:KAe04YzN",
  token: "token",
};

describe("XanoWarrantRepository", () => {
  it("reads a warrant and returns undefined on 404", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(authorized))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const repository = new XanoWarrantRepository({ ...config, fetch: fetcher });

    await expect(
      repository.getWarrant(authorized.authorization.warrant_id),
    ).resolves.toEqual(authorized);
    await expect(repository.getWarrant("missing")).resolves.toBeUndefined();
  });

  it("saves a warrant and validates the returned shape", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(authorized));
    const repository = new XanoWarrantRepository({ ...config, fetch: fetcher });

    const saved = await repository.saveWarrant(authorized);

    expect(saved).toEqual(authorized);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${config.baseUrl}/warrants`);
  });

  it("lists warrants and validates each returned shape", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([authorized]));
    const repository = new XanoWarrantRepository({ ...config, fetch: fetcher });

    const warrants = await repository.listWarrants();

    expect(warrants).toEqual([authorized]);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${config.baseUrl}/warrants`);
  });

  it("reads an execution and returns undefined on 404", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(execution))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const repository = new XanoWarrantRepository({ ...config, fetch: fetcher });

    await expect(repository.getExecution(execution.id)).resolves.toEqual(
      execution,
    );
    await expect(repository.getExecution("missing")).resolves.toBeUndefined();
  });

  it("lists executions and validates each returned shape", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([execution]));
    const repository = new XanoWarrantRepository({ ...config, fetch: fetcher });

    const executions = await repository.listExecutions();

    expect(executions).toEqual([execution]);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${config.baseUrl}/executions`);
  });

  it("reserves an execution and validates the returned shapes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        warrant: authorized,
        execution,
      }),
    );
    const repository = new XanoWarrantRepository({ ...config, fetch: fetcher });

    const result = await repository.reserveExecution({
      warrantId: authorized.authorization.warrant_id,
      expectedStateVersion: authorized.state_version,
      idempotencyKey: "demo-execution-1",
      now: new Date("2026-09-03T00:02:00Z"),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warrant.authorization.warrant_id).toBe(
        authorized.authorization.warrant_id,
      );
      expect(result.execution.id).toBe(execution.id);
    }
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `${config.baseUrl}/warrants/${authorized.authorization.warrant_id}/reserve`,
    );
  });

  it("updates execution state and finishes a warrant", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ...execution, state: "VERIFIED" }))
      .mockResolvedValueOnce(
        jsonResponse({ ...authorized, state: "EXECUTED" }),
      );
    const repository = new XanoWarrantRepository({ ...config, fetch: fetcher });

    const updated = await repository.setExecutionState(
      execution.id,
      "VERIFIED",
      {
        observed_record: {
          type: "A",
          host: "status",
          answer: "192.0.2.11",
          ttl: 300,
        },
      },
    );
    expect(updated.state).toBe("VERIFIED");

    const finished = await repository.finishWarrant(
      authorized.authorization.warrant_id,
      "EXECUTED",
    );
    expect(finished.state).toBe("EXECUTED");

    expect(fetcher.mock.calls[1]?.[0]).toBe(
      `${config.baseUrl}/warrants/${authorized.authorization.warrant_id}/finish`,
    );
  });

  it("appends and reads the audit chain", async () => {
    const event = {
      id: "33333333-3333-4333-8333-333333333333",
      warrant_id: authorized.authorization.warrant_id,
      sequence: 1,
      event_type: "execution.verified",
      actor_kind: "provider",
      actor_id: "name.com",
      before_state: "EXECUTING",
      after_state: "EXECUTED",
      metadata: {},
      previous_event_hash: null,
      event_hash: "a".repeat(64),
      created_at: "2026-09-03T00:02:00.000Z",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(event))
      .mockResolvedValueOnce(jsonResponse([event]));
    const repository = new XanoWarrantRepository({ ...config, fetch: fetcher });

    const appended = await repository.appendAudit({
      warrant_id: authorized.authorization.warrant_id,
      event_type: "execution.verified",
      actor_kind: "provider",
      actor_id: "name.com",
      before_state: "EXECUTING",
      after_state: "EXECUTED",
      metadata: {},
      created_at: "2026-09-03T00:02:00.000Z",
    });
    expect(appended.event_hash).toBe("a".repeat(64));

    const chain = await repository.getAuditChain(
      authorized.authorization.warrant_id,
    );
    expect(chain).toHaveLength(1);
  });
});
