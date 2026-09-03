import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createWarrantDraft } from "../src/protocol/warrant.js";
import type { DnsRecordAction } from "../src/protocol/schema.js";
import { createSigningProvider } from "../src/providers/foxit-signing.js";
import { createModelProvider } from "../src/providers/model.js";
import { NameComDnsProvider } from "../src/providers/namecom.js";
import { XanoWarrantRepository } from "../src/providers/xano-repository.js";
import { authorizeSignedWarrant } from "../src/execution/authorize-warrant.js";
import { executeWarrant } from "../src/execution/execute-warrant.js";
import { issueWarrantForSignature } from "../src/execution/issue-warrant.js";
import { proposeDnsAction } from "../src/execution/propose-action.js";
import { renderWarrantPdf } from "../src/execution/warrant-pdf.js";

const port = Number(process.env.PORT ?? 3000);
const domain = process.env.DEMO_DOMAIN ?? "agent-warrant-demo.com";
const recordId = Number.parseInt(process.env.DEMO_RECORD_ID ?? "13438668", 10);
const signerEmail = process.env.FOXIT_SIGNER_EMAIL ?? "rectinajh@gmail.com";

const policy = {
  domain,
  recordId,
  host: "status",
  recordType: "A" as const,
  minTtl: 300,
  maxTtl: 3_600,
};

const namecom = new NameComDnsProvider({
  username: process.env.NAMECOM_USERNAME ?? "",
  apiToken: process.env.NAMECOM_API_TOKEN ?? "",
  ...(process.env.NAMECOM_BASE_URL
    ? { baseUrl: process.env.NAMECOM_BASE_URL }
    : {}),
});

const signingProvider = createSigningProvider({
  clientId: process.env.FOXIT_CLIENT_ID ?? "",
  clientSecret: process.env.FOXIT_CLIENT_SECRET ?? "",
  ...(process.env.FOXIT_ESIGN_HOST
    ? { host: process.env.FOXIT_ESIGN_HOST }
    : {}),
});

const repository = new XanoWarrantRepository({
  baseUrl: process.env.XANO_API_BASE_URL ?? "",
  token: process.env.XANO_API_TOKEN ?? "",
});

const model = createModelProvider({
  apiKey: process.env.MODEL_API_KEY ?? "",
  model: process.env.MODEL_NAME ?? "kimi-k3",
  ...(process.env.MODEL_BASE_URL
    ? { baseUrl: process.env.MODEL_BASE_URL }
    : {}),
});

const htmlPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../web/index.html",
);
const html = readFileSync(htmlPath, "utf8");

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function propose(request: string) {
  const current = await namecom.getRecord(domain, recordId);
  const proposal = await proposeDnsAction({
    request,
    current,
    policy,
    model,
  });
  return { current, ...proposal };
}

async function issue(request: string) {
  const { current, action, reason } = await propose(request);
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
    current,
    action: action as DnsRecordAction,
    reason,
  };
}

async function execute(warrantId: string, envelopeId: string) {
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

async function replay(warrantId: string) {
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

const server = createServer(async (req, res) => {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );

  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/propose") {
      const body = await readJson(req);
      const request = String(body.request ?? "");
      if (!request.trim()) {
        sendJson(res, 400, { error: "request is required" });
        return;
      }
      sendJson(res, 200, await propose(request));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/issue") {
      const body = await readJson(req);
      const request = String(body.request ?? "");
      if (!request.trim()) {
        sendJson(res, 400, { error: "request is required" });
        return;
      }
      sendJson(res, 200, await issue(request));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/execute") {
      const body = await readJson(req);
      const warrantId = String(body.warrant_id ?? "");
      const envelopeId = String(body.envelope_id ?? "");
      if (!warrantId || !envelopeId) {
        sendJson(res, 400, {
          error: "warrant_id and envelope_id are required",
        });
        return;
      }
      sendJson(res, 200, await execute(warrantId, envelopeId));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/replay") {
      const warrantId = url.searchParams.get("warrant_id") ?? "";
      if (!warrantId) {
        sendJson(res, 400, { error: "warrant_id is required" });
        return;
      }
      sendJson(res, 200, await replay(warrantId));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      const warrantId = url.searchParams.get("warrant_id") ?? "";
      if (!warrantId) {
        sendJson(res, 400, { error: "warrant_id is required" });
        return;
      }
      const warrant = await repository.getWarrant(warrantId);
      const audit = await repository.getAuditChain(warrantId);
      sendJson(res, 200, { warrant, audit });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/current") {
      sendJson(res, 200, await namecom.getRecord(domain, recordId));
      return;
    }

    const envelopeStatus = url.pathname.match(
      /^\/api\/envelope\/([^/]+)\/status$/,
    );
    if (req.method === "GET" && envelopeStatus) {
      const envelopeId = decodeURIComponent(envelopeStatus[1] ?? "");
      try {
        await signingProvider.verifyCompletedEnvelope(envelopeId);
        sendJson(res, 200, { signed: true });
      } catch {
        sendJson(res, 200, { signed: false });
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { error: message });
  }
});

server.listen(port, () => {
  console.log(
    `Agent Warrant operator UI listening on http://localhost:${port}`,
  );
});
