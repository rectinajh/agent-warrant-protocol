import { createWarrantDraft } from "../src/protocol/warrant.js";
import { demoAction } from "../src/testing/fixtures.js";
import { createSigningProvider } from "../src/providers/foxit-signing.js";
import { issueWarrantForSignature } from "../src/execution/issue-warrant.js";
import { renderWarrantPdf } from "../src/execution/warrant-pdf.js";

const clientId = process.env.FOXIT_CLIENT_ID;
const clientSecret = process.env.FOXIT_CLIENT_SECRET;
const host = process.env.FOXIT_ESIGN_HOST;
const signerEmail = process.env.FOXIT_SIGNER_EMAIL ?? "rectinajh@gmail.com";

if (!clientId || !clientSecret) {
  console.error(
    "Issue blocked: provide FOXIT_CLIENT_ID and FOXIT_CLIENT_SECRET.",
  );
  process.exit(1);
}

const warrant = createWarrantDraft({
  warrantId: "11111111-1111-4111-8111-111111111111",
  agentId: "demo-dns-agent",
  signerEmail,
  reason: "Emergency status cutover",
  action: demoAction,
  issuedAt: new Date(),
});

const signingProvider = createSigningProvider({
  clientId,
  clientSecret,
  ...(host ? { host } : {}),
});

const result = await issueWarrantForSignature({
  warrant,
  signerEmail,
  signingProvider,
  renderWarrantPdf,
});

console.log(
  JSON.stringify(
    {
      gate: "foxit-issue",
      ready: true,
      warrant_id: result.warrant.authorization.warrant_id,
      warrant_state: result.warrant.state,
      envelope_id: result.envelope.envelopeId,
      signing_url: result.envelope.signingUrl,
    },
    null,
    2,
  ),
);
