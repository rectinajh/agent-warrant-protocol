import { describe, expect, it, vi } from "vitest";

import { createWarrantDraft } from "../protocol/warrant.js";
import { demoAction } from "../testing/fixtures.js";
import type { SigningProvider } from "../providers/signing.js";
import type { WarrantRepository } from "./types.js";
import { issueWarrantForSignature } from "./issue-warrant.js";
import { renderWarrantPdf } from "./warrant-pdf.js";

const draft = createWarrantDraft({
  warrantId: "11111111-1111-4111-8111-111111111111",
  agentId: "demo-dns-agent",
  signerEmail: "rectinajh@gmail.com",
  reason: "Emergency status cutover",
  action: demoAction,
  issuedAt: new Date("2026-09-03T00:00:00Z"),
  nonce: "abcdefghijklmnopqrstuv",
});

describe("renderWarrantPdf", () => {
  it("produces a PDF with embedded Foxit signing tags", () => {
    const pdf = renderWarrantPdf(draft);
    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("${signfield:1:y:______}");
    expect(text).toContain("${datefield:1:y::______}");
  });
});

describe("issueWarrantForSignature", () => {
  it("creates the envelope and moves the warrant to PENDING_SIGNATURE", async () => {
    const signingProvider = {
      createEnvelope: vi.fn().mockResolvedValue({
        provider: "foxit",
        envelopeId: "35720025",
        signingUrl: "https://na1.foxitesign.foxit.com//embedded/embeddedsign",
        status: "pending",
      }),
    } as unknown as SigningProvider;

    const result = await issueWarrantForSignature({
      warrant: draft,
      signerEmail: "rectinajh@gmail.com",
      signingProvider,
      renderWarrantPdf,
    });

    expect(result.envelope.envelopeId).toBe("35720025");
    expect(result.warrant.state).toBe("PENDING_SIGNATURE");
    expect(result.warrant.state_version).toBe(1);
    expect(signingProvider.createEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        signerEmail: "rectinajh@gmail.com",
        warrantId: draft.authorization.warrant_id,
      }),
    );
  });

  it("rejects a warrant that is not in DRAFT state", async () => {
    const signingProvider = {
      createEnvelope: vi.fn(),
    } as unknown as SigningProvider;

    await expect(
      issueWarrantForSignature({
        warrant: { ...draft, state: "AUTHORIZED" },
        signerEmail: "rectinajh@gmail.com",
        signingProvider,
        renderWarrantPdf,
      }),
    ).rejects.toThrow("expected DRAFT");
  });

  it("persists the issued warrant when a repository is provided", async () => {
    const signingProvider = {
      createEnvelope: vi.fn().mockResolvedValue({
        provider: "foxit",
        envelopeId: "35720025",
        signingUrl: "https://na1.foxitesign.foxit.com//embedded/embeddedsign",
        status: "pending",
      }),
    } as unknown as SigningProvider;

    const saveWarrant = vi.fn().mockImplementation(async (w: unknown) => w);
    const repository = { saveWarrant } as unknown as WarrantRepository;

    const result = await issueWarrantForSignature({
      warrant: draft,
      signerEmail: "rectinajh@gmail.com",
      signingProvider,
      renderWarrantPdf,
      repository,
    });

    expect(result.warrant.state).toBe("PENDING_SIGNATURE");
    expect(saveWarrant).toHaveBeenCalledWith(
      expect.objectContaining({ state: "PENDING_SIGNATURE", state_version: 1 }),
    );
  });
});
