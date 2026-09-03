import { canonicalSha256, digestEquals } from "./digests.js";

export interface AuditEventInput {
  warrant_id: string;
  event_type: string;
  actor_kind: "agent" | "human" | "provider" | "system";
  actor_id: string;
  before_state: string | null;
  after_state: string | null;
  metadata: Readonly<Record<string, unknown>>;
  created_at: string;
}

export interface AuditEvent extends AuditEventInput {
  sequence: number;
  previous_event_hash: string | null;
  event_hash: string;
}

type EventBody = Omit<AuditEvent, "event_hash">;

export function appendAuditEvent(
  chain: readonly AuditEvent[],
  input: AuditEventInput,
): AuditEvent {
  const previous = chain.at(-1);
  if (previous && previous.warrant_id !== input.warrant_id) {
    throw new Error(
      "Cannot append an event for a different warrant to this chain",
    );
  }

  const body: EventBody = {
    ...input,
    sequence: (previous?.sequence ?? 0) + 1,
    previous_event_hash: previous?.event_hash ?? null,
  };

  return {
    ...body,
    event_hash: canonicalSha256(body),
  };
}

export function verifyAuditChain(chain: readonly AuditEvent[]): boolean {
  let previousHash: string | null = null;
  let warrantId: string | null = null;

  for (const [index, event] of chain.entries()) {
    if (warrantId !== null && event.warrant_id !== warrantId) {
      return false;
    }
    warrantId = event.warrant_id;

    if (
      event.sequence !== index + 1 ||
      event.previous_event_hash !== previousHash
    ) {
      return false;
    }

    const { event_hash: eventHash, ...body } = event;
    const expectedHash = canonicalSha256(body);
    if (!digestEquals(eventHash, expectedHash)) {
      return false;
    }
    previousHash = eventHash;
  }

  return true;
}
