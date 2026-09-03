import { describe, expect, it, vi } from "vitest";

import { FoxitSigningProvider } from "./foxit-signing.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const config = {
  clientId: "foxit-test-client-id",
  clientSecret: "foxit-secret",
};

describe("FoxitSigningProvider", () => {
  it("creates an embedded signing envelope from a base64 PDF", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        result: "success",
        folder: { folderId: 35719979, folderStatus: "SHARED" },
        embeddedSigningSessions: [
          {
            emailIdOfSigner: "rectinajh@gmail.com",
            embeddedToken: "eetid",
            embeddedSessionURL:
              "https://na1.foxitesign.foxit.com//embedded/embeddedsign?eetid=eetid",
          },
        ],
      }),
    );
    const provider = new FoxitSigningProvider({ ...config, fetch: fetcher });
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    const envelope = await provider.createEnvelope({
      warrantId: "11111111-1111-4111-8111-111111111111",
      signerEmail: "rectinajh@gmail.com",
      warrantPdf: pdf,
      expiresAt: "2026-09-03T00:10:00.000Z",
    });

    expect(envelope).toEqual({
      provider: "foxit",
      envelopeId: "35719979",
      signingUrl:
        "https://na1.foxitesign.foxit.com//embedded/embeddedsign?eetid=eetid",
      status: "pending",
    });

    const call = fetcher.mock.calls[0];
    expect(call?.[0]).toBe(
      "https://na1.fusion.foxit.com/esign/api/v1/folders/createfolder",
    );
    expect(call?.[1]?.headers).toMatchObject({
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.inputType).toBe("base64");
    expect(body.base64FileString).toEqual(["JVBERg=="]);
    expect(body.embeddedSignersEmailIds).toEqual(["rectinajh@gmail.com"]);
  });

  it("throws when the provider rejects the envelope request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ result: "error", message: "invalid signer" }, 400),
      );
    const provider = new FoxitSigningProvider({ ...config, fetch: fetcher });

    await expect(
      provider.createEnvelope({
        warrantId: "11111111-1111-4111-8111-111111111111",
        signerEmail: "rectinajh@gmail.com",
        warrantPdf: new Uint8Array(),
        expiresAt: "2026-09-03T00:10:00.000Z",
      }),
    ).rejects.toThrow("Foxit eSign envelope creation failed");
  });

  it("downloads the executed artifact during verification", async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(pdfBytes, { status: 200 }));
    const provider = new FoxitSigningProvider({ ...config, fetch: fetcher });

    const verified = await provider.verifyCompletedEnvelope("35719979");

    expect(verified.status).toBe("completed");
    expect(verified.signedPdf).toEqual(pdfBytes);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://na1.fusion.foxit.com/esign/api/v1/folders/download?folderId=35719979",
    );
  });

  it("reports a not-yet-executed envelope as pending", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("folder 35719979 is not executed yet.", { status: 400 }),
      );
    const provider = new FoxitSigningProvider({ ...config, fetch: fetcher });

    await expect(provider.verifyCompletedEnvelope("35719979")).rejects.toThrow(
      "not executed yet",
    );
  });
});
