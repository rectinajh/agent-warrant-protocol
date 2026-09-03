import { createWarrantDraft } from "../src/protocol/warrant.js";
import { applyWarrantEvent } from "../src/protocol/state-machine.js";
import { demoAction } from "../src/testing/fixtures.js";
import { createSigningProvider } from "../src/providers/foxit-signing.js";
import { authorizeSignedWarrant } from "../src/execution/authorize-warrant.js";

const clientId = process.env.FOXIT_CLIENT_ID;
const clientSecret = process.env.FOXIT_CLIENT_SECRET;
const host = process.env.FOXIT_ESIGN_HOST;
const envelopeId = process.env.FOXIT_ENVELOPE_ID ?? "35720077";
const signerEmail = process.env.FOXIT_SIGNER_EMAIL ?? "rectinajh@gmail.com";

if (!clientId || !clientSecret) {
  console.error(
    "Authorize blocked: provide FOXIT_CLIENT_ID and FOXIT_CLIENT_SECRET.",
  );
  process.exit(1);
}

const draft = createWarrantDraft({
  warrantId: "11111111-1111-4111-8111-111111111111",
  agentId: "demo-dns-agent",
  signerEmail,
  reason: "Emergency status cutover",
  action: demoAction,
  issuedAt: new Date(),
});
const pending = applyWarrantEvent(draft, "ENVELOPE_CREATED");

const signingProvider = createSigningProvider({
  clientId,
  clientSecret,
  ...(host ? { host } : {}),
});

const result = await authorizeSignedWarrant({
  warrant: pending,
  envelopeId,
  signingProvider,
});

console.log(
  JSON.stringify(
    {
      gate: "foxit-authorize",
      ready: true,
      envelope_id: envelopeId,
      warrant_state: result.warrant.state,
      signed_pdf_sha256: result.signedPdfSha256,
      signed_pdf_bytes: result.signedPdf.length,
    },
    null,
    2,
  ),
);
