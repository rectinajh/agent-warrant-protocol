import {
  dnsRecordActionSchema,
  type DnsRecordAction,
  type DnsRecordSnapshot,
} from "../protocol/schema.js";
import type { DemoPolicy } from "../protocol/policy.js";
import type { ModelProvider } from "../providers/model.js";

export interface DnsProposal {
  action: DnsRecordAction;
  reason: string;
}

export interface ProposeDnsActionInput {
  request: string;
  current: DnsRecordSnapshot;
  policy: DemoPolicy;
  model: ModelProvider;
}

const SYSTEM_PROMPT = [
  "You turn a plain-language operator request into a single DNS record change.",
  "Respond with ONLY a JSON object (no prose) shaped exactly like:",
  '{"answer":"<new record value>","ttl":<seconds>,"reason":"<short reason>"}',
  "",
  "Rules:",
  '- The record type and host are fixed by the policy; choose only "answer" and "ttl".',
  '- Keep "ttl" within the policy\'s allowed range.',
  '- "answer" is the new value for the record (for an A record, an IPv4 address).',
  '- "reason" is a short, human-readable explanation of why the change is being made.',
].join("\n");

export async function proposeDnsAction(
  input: ProposeDnsActionInput,
): Promise<DnsProposal> {
  const { request, current, policy, model } = input;

  const userPrompt = JSON.stringify({
    operator_request: request,
    current_record: current,
    policy: {
      domain: policy.domain,
      record_id: policy.recordId,
      host: policy.host,
      record_type: policy.recordType,
      ttl_min: policy.minTtl,
      ttl_max: policy.maxTtl,
    },
  });

  const raw = (await model.chatJson([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ])) as { answer?: unknown; ttl?: unknown; reason?: unknown };

  if (typeof raw.answer !== "string" || raw.answer.trim() === "") {
    throw new Error("Model proposal did not include a non-empty answer");
  }

  const ttlRaw = Number(raw.ttl);
  const ttl = Number.isFinite(ttlRaw)
    ? Math.min(policy.maxTtl, Math.max(policy.minTtl, Math.round(ttlRaw)))
    : policy.minTtl;

  const reason =
    typeof raw.reason === "string" && raw.reason.trim() !== ""
      ? raw.reason.trim()
      : `Operator requested: ${request.trim()}`;

  const action = dnsRecordActionSchema.parse({
    version: "action.v1",
    action_type: "dns.record.update",
    resource: {
      provider: "name.com",
      environment: "sandbox",
      domain: policy.domain,
      record_id: policy.recordId,
    },
    precondition: current,
    effect: {
      type: policy.recordType,
      host: policy.host,
      answer: raw.answer.trim(),
      ttl,
    },
  });

  return { action, reason: reason.slice(0, 500) };
}
