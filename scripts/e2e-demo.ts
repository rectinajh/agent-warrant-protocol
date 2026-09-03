import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { createWarrantDraft } from "../src/protocol/warrant.js";
import { createSigningProvider } from "../src/providers/foxit-signing.js";
import { NameComDnsProvider } from "../src/providers/namecom.js";
import { issueWarrantForSignature } from "../src/execution/issue-warrant.js";
import { authorizeSignedWarrant } from "../src/execution/authorize-warrant.js";
import { executeWarrant } from "../src/execution/execute-warrant.js";
import { XanoWarrantRepository } from "../src/providers/xano-repository.js";
import { renderWarrantPdf } from "../src/execution/warrant-pdf.js";

const STATE_FILE = "/tmp/agent-warrant-e2e.json";
const mode = process.argv[2] ?? "issue";
const domain = process.env.DEMO_DOMAIN!;
const recordId = Number.parseInt(process.env.DEMO_RECORD_ID!, 10);
const normalAnswer = "192.0.2.10";
const emergencyAnswer = "192.0.2.11";
const signerEmail = process.env.FOXIT_SIGNER_EMAIL ?? "rectinajh@gmail.com";

const namecom = new NameComDnsProvider({
  username: process.env.NAMECOM_USERNAME!,
  apiToken: process.env.NAMECOM_API_TOKEN!,
  ...(process.env.NAMECOM_BASE_URL
    ? { baseUrl: process.env.NAMECOM_BASE_URL }
    : {}),
});

const signingProvider = createSigningProvider({
  clientId: process.env.FOXIT_CLIENT_ID!,
  clientSecret: process.env.FOXIT_CLIENT_SECRET!,
  ...(process.env.FOXIT_ESIGN_HOST
    ? { host: process.env.FOXIT_ESIGN_HOST }
    : {}),
});

const repository = new XanoWarrantRepository({
  baseUrl: process.env.XANO_API_BASE_URL!,
  token: process.env.XANO_API_TOKEN!,
});

if (mode === "issue") {
  const current = await namecom.getRecord(domain, recordId);
  console.log(
    JSON.stringify(
      { stage: "preflight", domain, record_id: recordId, live: current },
      null,
      2,
    ),
  );

  const warrantId = randomUUID();
  const draft = createWarrantDraft({
    warrantId,
    agentId: "demo-dns-agent",
    signerEmail,
    reason: "Emergency status cutover",
    action: {
      version: "action.v1",
      action_type: "dns.record.update",
      resource: {
        provider: "name.com",
        environment: "sandbox",
        domain,
        record_id: recordId,
      },
      precondition: current,
      effect: {
        type: "A",
        host: "status",
        answer: emergencyAnswer,
        ttl: 300,
      },
    },
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

  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        warrant_id: warrant.authorization.warrant_id,
        envelope_id: envelope.envelopeId,
      },
      null,
      2,
    ),
  );

  console.log(
    JSON.stringify(
      {
        stage: "issued",
        ready: true,
        warrant_id: warrantId,
        warrant_state: warrant.state,
        envelope_id: envelope.envelopeId,
        signing_url: envelope.signingUrl,
      },
      null,
      2,
    ),
  );
  console.error(
    "\nOpen the signing_url and sign. Then run: node scripts/e2e-demo.ts execute",
  );
} else if (mode === "execute") {
  if (!existsSync(STATE_FILE)) {
    console.error(
      "No issued warrant state found. Run: node scripts/e2e-demo.ts issue",
    );
    process.exit(1);
  }

  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    warrant_id: string;
    envelope_id: string;
  };
  const { warrant_id, envelope_id } = state;

  const warrant = await repository.getWarrant(warrant_id);
  if (!warrant) {
    console.error(`No warrant found in Xano for ${warrant_id}`);
    process.exit(1);
  }

  const signed = await authorizeSignedWarrant({
    warrant,
    envelopeId: envelope_id,
    signingProvider,
    repository,
  });
  console.log(
    JSON.stringify(
      {
        stage: "authorized",
        warrant_state: signed.warrant.state,
        signed_pdf_sha256: signed.signedPdfSha256,
      },
      null,
      2,
    ),
  );

  const result = await executeWarrant({
    warrantId: signed.warrant.authorization.warrant_id,
    expectedStateVersion: signed.warrant.state_version,
    idempotencyKey: "e2e-demo-execution",
    now: new Date(),
    policy: {
      domain,
      recordId,
      host: "status",
      recordType: "A",
      minTtl: 300,
      maxTtl: 3_600,
    },
    repository,
    provider: namecom,
  });

  if (result.status === "executed") {
    console.log(
      JSON.stringify(
        {
          stage: "executed",
          ready: true,
          observed: result.receipt.execution.observed,
          receipt_id: result.receipt.receipt_id,
          event_chain_head: result.receipt.event_chain_head,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      JSON.stringify(
        { stage: "reconciling", execution_state: result.execution.state },
        null,
        2,
      ),
    );
  }
} else {
  console.error("Usage: node scripts/e2e-demo.ts [issue|execute]");
  process.exit(2);
}
