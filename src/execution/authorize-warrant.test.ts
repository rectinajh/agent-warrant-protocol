import { describe, expect, it, vi } from "vitest";

import { createWarrantDraft } from "../protocol/warrant.js";
import { applyWarrantEvent } from "../protocol/state-machine.js";
import { sha256Hex } from "../protocol/digests.js";
import { demoAction } from "../testing/fixtures.js";
import type { SigningProvider } from "../providers/signing.js";
import { authorizeSignedWarrant } from "./authorize-warrant.js";

const draft = createWarrantDraft({
  warrantId: "11111111-1111-4111-8111-111111111111",
  agentId: "demo-dns-agent",
  signerEmail: "rectinajh@gmail.com",
  reason: "Emergency status cutover",
  action: demoAction,
  issuedAt: new Date("2026-09-03T00:00:00Z"),
  nonce: "abcdefghijklmnopqrstuv",
});

const pending = applyWarrantEvent(draft, "ENVELOPE_CREATED");

describe("authorizeSignedWarrant", () => {
  it("authorizes a signed envelope and records the signed PDF hash", async () => {
    const signedPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const signingProvider = {
      verifyCompletedEnvelope: vi.fn().mockResolvedValue({
        provider: "foxit",
        envelopeId: "35720077",
        signingUrl: "",
        status: "completed",
        signedPdf,
      }),
    } as unknown as SigningProvider;

    const result = await authorizeSignedWarrant({
      warrant: pending,
      envelopeId: "35720077",
      signingProvider,
    });

    expect(result.warrant.state).toBe("AUTHORIZED");
    expect(result.warrant.state_version).toBe(2);
    expect(result.signedPdfSha256).toBe(sha256Hex(signedPdf));
    expect(result.signedPdf).toEqual(signedPdf);
  });

  it("rejects a warrant that is not awaiting signature", async () => {
    const signingProvider = {
      verifyCompletedEnvelope: vi.fn(),
    } as unknown as SigningProvider;

    await expect(
      authorizeSignedWarrant({
        warrant: { ...draft, state: "DRAFT" },
        envelopeId: "35720077",
        signingProvider,
      }),
    ).rejects.toThrow("expected PENDING_SIGNATURE");
  });
});
