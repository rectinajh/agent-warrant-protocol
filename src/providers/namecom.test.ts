import { describe, expect, it, vi } from "vitest";

import {
  AmbiguousProviderError,
  ProviderRejectedError,
} from "../protocol/errors.js";
import { demoAction, normalRecord } from "../testing/fixtures.js";
import { NameComDnsProvider } from "./namecom.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("NameComDnsProvider", () => {
  it("reads and updates only through the sandbox endpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          id: 12_345,
          ...normalRecord,
          domainName: "sandbox-domain.example",
        }),
      )
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(
        response({
          id: 12_345,
          ...demoAction.effect,
          domainName: "sandbox-domain.example",
        }),
      );
    const provider = new NameComDnsProvider({
      username: "demo-test",
      apiToken: "placeholder-token",
      fetch: fetcher,
    });

    await expect(
      provider.getRecord("sandbox-domain.example", 12_345),
    ).resolves.toEqual(normalRecord);
    await provider.updateRecord(demoAction);
    await expect(
      provider.getRecord("sandbox-domain.example", 12_345),
    ).resolves.toEqual(demoAction.effect);

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://api.dev.name.com/core/v1/domains/sandbox-domain.example/records/12345",
      expect.objectContaining({ method: "PUT" }),
    );
    const updateInit = fetcher.mock.calls[1]?.[1];
    expect(JSON.parse(String(updateInit?.body))).toEqual(demoAction.effect);
  });

  it("rejects a production base URL", () => {
    expect(
      () =>
        new NameComDnsProvider({
          username: "demo",
          apiToken: "placeholder-token",
          baseUrl: "https://api.name.com",
        }),
    ).toThrow("only permits the name.com sandbox");
  });

  it("distinguishes provider rejection from an ambiguous network result", async () => {
    const rejected = new NameComDnsProvider({
      username: "demo-test",
      apiToken: "placeholder-token",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(response({ message: "no" }, 400)),
    });
    await expect(rejected.updateRecord(demoAction)).rejects.toBeInstanceOf(
      ProviderRejectedError,
    );

    const ambiguous = new NameComDnsProvider({
      username: "demo-test",
      apiToken: "placeholder-token",
      fetch: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new TypeError("socket closed")),
    });
    await expect(ambiguous.updateRecord(demoAction)).rejects.toBeInstanceOf(
      AmbiguousProviderError,
    );
  });
});
