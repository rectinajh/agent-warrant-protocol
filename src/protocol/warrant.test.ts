import { describe, expect, it } from "vitest";

import { ProtocolError } from "./errors.js";
import { assertWarrantIntegrity, createWarrantDraft } from "./warrant.js";
import { demoAction } from "../testing/fixtures.js";

const input = {
  warrantId: "11111111-1111-4111-8111-111111111111",
  agentId: "demo-dns-agent",
  signerEmail: " Operator@Example.com ",
  reason: "Emergency status-page cutover",
  action: demoAction,
  issuedAt: new Date("2026-09-03T00:00:00Z"),
  nonce: "abcdefghijklmnopqrstuv",
};

describe("warrant integrity", () => {
  it("creates deterministic dual digests for fixed input", () => {
    const first = createWarrantDraft(input);
    const second = createWarrantDraft(input);

    expect(first.authorization.action_digest).toBe(
      second.authorization.action_digest,
    );
    expect(first.warrant_digest).toBe(second.warrant_digest);
    expect(first.authorization.signer_email_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.authorization.expires_at).toBe("2026-09-03T00:10:00.000Z");
    expect(() => assertWarrantIntegrity(first)).not.toThrow();
  });

  it("detects a mutated action", () => {
    const warrant = createWarrantDraft(input);
    const tampered = structuredClone(warrant);
    tampered.action.effect.answer = "192.0.2.99";

    expect(() => assertWarrantIntegrity(tampered)).toThrowError(
      expect.objectContaining<Partial<ProtocolError>>({
        code: "ACTION_INTEGRITY_FAILED",
      }),
    );
  });

  it("detects a mutated authorization envelope", () => {
    const warrant = createWarrantDraft(input);
    const tampered = structuredClone(warrant);
    tampered.authorization.reason = "Different reason";

    expect(() => assertWarrantIntegrity(tampered)).toThrowError(
      expect.objectContaining<Partial<ProtocolError>>({
        code: "WARRANT_INTEGRITY_FAILED",
      }),
    );
  });

  it("rejects authorization windows outside the MVP policy", () => {
    expect(() =>
      createWarrantDraft({ ...input, authorizationWindowSeconds: 30 }),
    ).toThrow("between 60 and 900");
  });
});
