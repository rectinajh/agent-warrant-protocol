import { applyWarrantEvent } from "../protocol/state-machine.js";
import type { IssuedWarrant } from "../protocol/schema.js";
import type { SigningEnvelope, SigningProvider } from "../providers/signing.js";
import type { WarrantRepository } from "./types.js";

export interface IssueWarrantForSignatureInput {
  warrant: IssuedWarrant;
  signerEmail: string;
  signingProvider: SigningProvider;
  renderWarrantPdf: (warrant: IssuedWarrant) => Uint8Array;
  repository?: WarrantRepository;
}

export interface IssueWarrantForSignatureResult {
  envelope: SigningEnvelope;
  warrant: IssuedWarrant;
}

export async function issueWarrantForSignature(
  input: IssueWarrantForSignatureInput,
): Promise<IssueWarrantForSignatureResult> {
  const {
    warrant,
    signerEmail,
    signingProvider,
    renderWarrantPdf,
    repository,
  } = input;

  if (warrant.state !== "DRAFT") {
    throw new Error(
      `Cannot issue a warrant in state ${warrant.state}; expected DRAFT`,
    );
  }

  const warrantPdf = renderWarrantPdf(warrant);
  const envelope = await signingProvider.createEnvelope({
    warrantId: warrant.authorization.warrant_id,
    signerEmail,
    warrantPdf,
    expiresAt: warrant.authorization.expires_at,
  });

  const issued = applyWarrantEvent(warrant, "ENVELOPE_CREATED");

  return {
    envelope,
    warrant: repository ? await repository.saveWarrant(issued) : issued,
  };
}
