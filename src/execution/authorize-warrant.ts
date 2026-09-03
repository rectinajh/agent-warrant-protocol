import { applyWarrantEvent } from "../protocol/state-machine.js";
import { sha256Hex } from "../protocol/digests.js";
import type { IssuedWarrant } from "../protocol/schema.js";
import type { SigningProvider } from "../providers/signing.js";
import type { WarrantRepository } from "./types.js";

export interface AuthorizeSignedWarrantInput {
  warrant: IssuedWarrant;
  envelopeId: string;
  signingProvider: SigningProvider;
  repository?: WarrantRepository;
}

export interface AuthorizeSignedWarrantResult {
  warrant: IssuedWarrant;
  signedPdfSha256: string;
  signedPdf: Uint8Array;
}

export async function authorizeSignedWarrant(
  input: AuthorizeSignedWarrantInput,
): Promise<AuthorizeSignedWarrantResult> {
  const { warrant, envelopeId, signingProvider, repository } = input;

  if (warrant.state !== "PENDING_SIGNATURE") {
    throw new Error(
      `Cannot authorize a warrant in state ${warrant.state}; expected PENDING_SIGNATURE`,
    );
  }

  const signed = await signingProvider.verifyCompletedEnvelope(envelopeId);
  const signedPdfSha256 = sha256Hex(signed.signedPdf);

  const authorized = applyWarrantEvent(warrant, "SIGNATURE_VERIFIED");

  return {
    warrant: repository ? await repository.saveWarrant(authorized) : authorized,
    signedPdfSha256,
    signedPdf: signed.signedPdf,
  };
}
