import { Buffer } from "node:buffer";

import type { DnsProvider } from "../execution/types.js";
import {
  AmbiguousProviderError,
  ProviderRejectedError,
} from "../protocol/errors.js";
import {
  dnsRecordSnapshotSchema,
  type DnsRecordAction,
  type DnsRecordSnapshot,
} from "../protocol/schema.js";

interface NameComRecordResponse {
  id: number;
  type: string;
  host: string | null;
  answer: string;
  ttl: number;
}

export interface NameComClientConfig {
  username: string;
  apiToken: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export class NameComDnsProvider implements DnsProvider {
  readonly baseUrl: string;
  private readonly authorization: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(config: NameComClientConfig) {
    this.baseUrl = (config.baseUrl ?? "https://api.dev.name.com").replace(
      /\/$/,
      "",
    );
    if (this.baseUrl !== "https://api.dev.name.com") {
      throw new Error(
        "The hackathon client only permits the name.com sandbox base URL",
      );
    }
    this.authorization = `Basic ${Buffer.from(`${config.username}:${config.apiToken}`).toString("base64")}`;
    this.fetcher = config.fetch ?? globalThis.fetch;
  }

  private headers(): HeadersInit {
    return {
      Accept: "application/json",
      Authorization: this.authorization,
      "Content-Type": "application/json",
    };
  }

  async getRecord(
    domain: string,
    recordId: number,
  ): Promise<DnsRecordSnapshot> {
    const response = await this.fetcher(
      `${this.baseUrl}/core/v1/domains/${encodeURIComponent(domain)}/records/${recordId}`,
      { headers: this.headers(), method: "GET" },
    );

    if (!response.ok) {
      throw new ProviderRejectedError("name.com rejected the DNS record read", {
        operation: "get_record",
        status: response.status,
      });
    }

    const record = (await response.json()) as NameComRecordResponse;
    return dnsRecordSnapshotSchema.parse({
      type: record.type,
      host: record.host ?? "@",
      answer: record.answer,
      ttl: record.ttl,
    });
  }

  async updateRecord(action: DnsRecordAction): Promise<void> {
    const { domain, record_id: recordId } = action.resource;

    try {
      const response = await this.fetcher(
        `${this.baseUrl}/core/v1/domains/${encodeURIComponent(domain)}/records/${recordId}`,
        {
          body: JSON.stringify(action.effect),
          headers: this.headers(),
          method: "PUT",
        },
      );

      if (!response.ok) {
        throw new ProviderRejectedError(
          "name.com rejected the DNS record update",
          {
            operation: "update_record",
            status: response.status,
          },
        );
      }
    } catch (error) {
      if (error instanceof ProviderRejectedError) {
        throw error;
      }
      throw new AmbiguousProviderError(
        "The name.com update ended without a definitive provider response",
        { operation: "update_record" },
      );
    }
  }
}
