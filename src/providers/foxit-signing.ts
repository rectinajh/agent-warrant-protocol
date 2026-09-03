import { Buffer } from "node:buffer";

import type {
  CreateSigningEnvelopeInput,
  SigningEnvelope,
  SigningProvider,
  VerifiedSigningEnvelope,
} from "./signing.js";
import { UnconfiguredSigningProvider } from "./signing.js";

export interface FoxitSigningConfig {
  clientId: string;
  clientSecret: string;
  host?: string;
  fetch?: typeof globalThis.fetch;
}

interface FoxitCreateFolderResponse {
  folder?: {
    folderId?: number | string;
    folderStatus?: string;
  };
  embeddedSigningSessions?: Array<{
    emailIdOfSigner?: string;
    embeddedToken?: string;
    embeddedSessionURL?: string;
  }>;
  result?: string;
  message?: string;
}

const DEFAULT_HOST = "https://na1.fusion.foxit.com";

/**
 * Returns the live Foxit eSign adapter when credentials are configured, or a
 * fail-closed stub otherwise. This is the wiring point for the issuance path.
 */
export function createSigningProvider(
  config: FoxitSigningConfig,
): SigningProvider {
  if (!config.clientId || !config.clientSecret) {
    return new UnconfiguredSigningProvider();
  }
  return new FoxitSigningProvider(config);
}

/**
 * Live Foxit eSign adapter against the Fusion API platform.
 *
 * The eSign API shares the Foxit PDF API credential pair and authenticates by
 * sending `client_id` and `client_secret` as request headers. There is no OAuth
 * token exchange. The signing endpoint is `/esign/api/v1/folders/createfolder`
 * and the completed artifact is read from `/esign/api/v1/folders/download`.
 */
export class FoxitSigningProvider implements SigningProvider {
  readonly host: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(config: FoxitSigningConfig) {
    this.host = (config.host ?? DEFAULT_HOST).replace(/\/$/, "");
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.fetcher = config.fetch ?? globalThis.fetch;
  }

  private headers(): HeadersInit {
    return {
      "Content-Type": "application/json",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    };
  }

  async createEnvelope(
    input: CreateSigningEnvelopeInput,
  ): Promise<SigningEnvelope> {
    const response = await this.fetcher(
      `${this.host}/esign/api/v1/folders/createfolder`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          folderName: `Agent Warrant ${input.warrantId}`,
          inputType: "base64",
          base64FileString: [Buffer.from(input.warrantPdf).toString("base64")],
          fileNames: ["warrant.pdf"],
          processTextTags: true,
          processAcroFields: false,
          createEmbeddedSigningSession: true,
          embeddedSignersEmailIds: [input.signerEmail],
          sendNow: false,
          parties: [
            {
              // The signer name is not part of the protocol contract yet; the
              // demo signs as the operator's configured account.
              firstName: "Operator",
              lastName: "Signer",
              emailId: input.signerEmail,
              permission: "FILL_FIELDS_AND_SIGN",
              sequence: 1,
            },
          ],
        }),
      },
    );

    const payload = (await response.json()) as FoxitCreateFolderResponse;
    const folderId = payload.folder?.folderId;
    const signingUrl = payload.embeddedSigningSessions?.[0]?.embeddedSessionURL;

    if (!response.ok || folderId === undefined || !signingUrl) {
      throw new Error(
        `Foxit eSign envelope creation failed: ${JSON.stringify(payload)}`,
      );
    }

    return {
      provider: "foxit",
      envelopeId: String(folderId),
      signingUrl,
      status: "pending",
    };
  }

  async verifyCompletedEnvelope(
    envelopeId: string,
  ): Promise<VerifiedSigningEnvelope> {
    const response = await this.fetcher(
      `${this.host}/esign/api/v1/folders/download?folderId=${encodeURIComponent(envelopeId)}`,
      {
        method: "GET",
        headers: this.headers(),
      },
    );

    if (response.status === 400) {
      throw new Error(
        `Foxit eSign envelope is not executed yet: ${await response.text()}`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `Foxit eSign artifact download failed: ${response.status}`,
      );
    }

    const signedPdf = new Uint8Array(await response.arrayBuffer());
    return {
      provider: "foxit",
      envelopeId,
      signingUrl: "",
      status: "completed",
      signedPdf,
    };
  }
}
