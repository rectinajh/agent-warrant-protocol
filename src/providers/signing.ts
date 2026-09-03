export interface CreateSigningEnvelopeInput {
  warrantId: string;
  signerEmail: string;
  warrantPdf: Uint8Array;
  expiresAt: string;
}

export interface SigningEnvelope {
  provider: "foxit";
  envelopeId: string;
  signingUrl: string;
  status: "pending" | "completed" | "declined" | "cancelled";
}

export interface VerifiedSigningEnvelope extends SigningEnvelope {
  status: "completed";
  signedPdf: Uint8Array;
}

export interface SigningProvider {
  createEnvelope(input: CreateSigningEnvelopeInput): Promise<SigningEnvelope>;
  verifyCompletedEnvelope(envelopeId: string): Promise<VerifiedSigningEnvelope>;
}

export class UnconfiguredSigningProvider implements SigningProvider {
  async createEnvelope(
    _input: CreateSigningEnvelopeInput,
  ): Promise<SigningEnvelope> {
    throw new Error(
      "Foxit signing is not configured. Set credentials and implement the account-specific request fixture before enabling issuance.",
    );
  }

  async verifyCompletedEnvelope(
    _envelopeId: string,
  ): Promise<VerifiedSigningEnvelope> {
    throw new Error(
      "Foxit signing is not configured. A callback or redirect cannot authorize a warrant.",
    );
  }
}
