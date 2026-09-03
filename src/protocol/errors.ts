export type ProtocolErrorCode =
  | "ACTION_INTEGRITY_FAILED"
  | "EXECUTION_IN_PROGRESS"
  | "INVALID_STATE_TRANSITION"
  | "POSTCONDITION_FAILED"
  | "PRECONDITION_CHANGED"
  | "PROVIDER_REJECTED"
  | "SIGNATURE_NOT_VERIFIED"
  | "TARGET_NOT_ALLOWED"
  | "UNKNOWN_PROVIDER_STATE"
  | "WARRANT_ALREADY_CONSUMED"
  | "WARRANT_EXPIRED"
  | "WARRANT_INTEGRITY_FAILED"
  | "WARRANT_NOT_ACTIVE";

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: ProtocolErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.details = details;
  }
}

export class ProviderRejectedError extends ProtocolError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("PROVIDER_REJECTED", message, details);
    this.name = "ProviderRejectedError";
  }
}

export class AmbiguousProviderError extends ProtocolError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("UNKNOWN_PROVIDER_STATE", message, details);
    this.name = "AmbiguousProviderError";
  }
}
