import { randomUUID } from "node:crypto";

import { authorizeSignedWarrant } from "../execution/authorize-warrant.js";
import { executeWarrant } from "../execution/execute-warrant.js";
import type { ExecuteWarrantResult } from "../execution/types.js";
import { issueWarrantForSignature } from "../execution/issue-warrant.js";
import { proposeDnsAction } from "../execution/propose-action.js";
import { renderWarrantPdf } from "../execution/warrant-pdf.js";
import type { DemoPolicy } from "../protocol/policy.js";
import type { DnsRecordAction, DnsRecordSnapshot } from "../protocol/schema.js";
import { createWarrantDraft } from "../protocol/warrant.js";
import { createSigningProvider } from "../providers/foxit-signing.js";
import { createModelProvider } from "../providers/model.js";
import { NameComDnsProvider } from "../providers/namecom.js";
import { XanoWarrantRepository } from "../providers/xano-repository.js";

export interface DnsProposalResult {
  current: DnsRecordSnapshot;
  action: DnsRecordAction;
  reason: string;
}

export interface WarrantApp {
  current(): Promise<DnsRecordSnapshot>;
  propose(request: string): Promise<DnsProposalResult>;
  issue(request: string): Promise<Record<string, unknown>>;
  execute(warrantId: string, envelopeId: string): Promise<ExecuteWarrantResult>;
  replay(warrantId: string): Promise<unknown>;
  status(warrantId: string): Promise<{ warrant: unknown; audit: unknown }>;
  envelopeStatus(envelopeId: string): Promise<{ signed: boolean }>;
}

/**
 * Provider wiring plus the operator flow handlers, shared by the local
 * `node:http` server and the Vercel serverless functions.
 */
export function createWarrantApp(
  env: NodeJS.ProcessEnv = process.env,
): WarrantApp {
  const domain = env.DEMO_DOMAIN ?? "agent-warrant-demo.com";
  const recordId = Number.parseInt(env.DEMO_RECORD_ID ?? "13438668", 10);
  const signerEmail = env.FOXIT_SIGNER_EMAIL ?? "rectinajh@gmail.com";
  const policy: DemoPolicy = {
    domain,
    recordId,
    host: "status",
    recordType: "A",
    minTtl: 300,
    maxTtl: 3_600,
  };

  const namecom = new NameComDnsProvider({
    username: env.NAMECOM_USERNAME ?? "",
    apiToken: env.NAMECOM_API_TOKEN ?? "",
    ...(env.NAMECOM_BASE_URL ? { baseUrl: env.NAMECOM_BASE_URL } : {}),
  });

  const signingProvider = createSigningProvider({
    clientId: env.FOXIT_CLIENT_ID ?? "",
    clientSecret: env.FOXIT_CLIENT_SECRET ?? "",
    ...(env.FOXIT_ESIGN_HOST ? { host: env.FOXIT_ESIGN_HOST } : {}),
  });

  const repository = new XanoWarrantRepository({
    baseUrl: env.XANO_API_BASE_URL ?? "",
    token: env.XANO_API_TOKEN ?? "",
  });

  const model = createModelProvider({
    apiKey: env.MODEL_API_KEY ?? "",
    model: env.MODEL_NAME ?? "kimi-k3",
    ...(env.MODEL_BASE_URL ? { baseUrl: env.MODEL_BASE_URL } : {}),
  });

  async function current(): Promise<DnsRecordSnapshot> {
    return namecom.getRecord(domain, recordId);
  }

  async function propose(request: string): Promise<DnsProposalResult> {
    const c = await current();
    const proposal = await proposeDnsAction({
      request,
      current: c,
      policy,
      model,
    });
    return { current: c, ...proposal };
  }

  async function issue(request: string): Promise<Record<string, unknown>> {
    const { current: c, action, reason } = await propose(request);
    const warrantId = randomUUID();
    const draft = createWarrantDraft({
      warrantId,
      agentId: "web-operator-agent",
      signerEmail,
      reason,
      action,
      issuedAt: new Date(),
    });

    await repository.saveWarrant(draft);
    const { envelope, warrant } = await issueWarrantForSignature({
      warrant: draft,
      signerEmail,
      signingProvider,
      renderWarrantPdf,
      repository,
    });

    return {
      warrant_id: warrant.authorization.warrant_id,
      envelope_id: envelope.envelopeId,
      signing_url: envelope.signingUrl,
      state: warrant.state,
      current: c,
      action,
      reason,
    };
  }

  async function execute(
    warrantId: string,
    envelopeId: string,
  ): Promise<ExecuteWarrantResult> {
    const warrant = await repository.getWarrant(warrantId);
    if (!warrant) {
      throw new Error(`Unknown warrant ${warrantId}`);
    }

    const signed = await authorizeSignedWarrant({
      warrant,
      envelopeId,
      signingProvider,
      repository,
    });

    return executeWarrant({
      warrantId,
      expectedStateVersion: signed.warrant.state_version,
      idempotencyKey: `web-${randomUUID()}`,
      now: new Date(),
      policy,
      repository,
      provider: namecom,
    });
  }

  async function replay(warrantId: string): Promise<unknown> {
    const warrant = await repository.getWarrant(warrantId);
    if (!warrant) {
      throw new Error(`Unknown warrant ${warrantId}`);
    }

    return repository.reserveExecution({
      warrantId,
      expectedStateVersion: warrant.state_version,
      idempotencyKey: `replay-${randomUUID()}`,
      now: new Date(),
    });
  }

  async function status(
    warrantId: string,
  ): Promise<{ warrant: unknown; audit: unknown }> {
    const warrant = await repository.getWarrant(warrantId);
    const audit = await repository.getAuditChain(warrantId);
    return { warrant, audit };
  }

  async function envelopeStatus(
    envelopeId: string,
  ): Promise<{ signed: boolean }> {
    try {
      await signingProvider.verifyCompletedEnvelope(envelopeId);
      return { signed: true };
    } catch {
      return { signed: false };
    }
  }

  return { current, propose, issue, execute, replay, status, envelopeStatus };
}
