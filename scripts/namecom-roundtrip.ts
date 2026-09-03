import { NameComDnsProvider } from "../src/providers/namecom.js";
import type { DnsRecordAction } from "../src/protocol/schema.js";

const domain = process.env.DEMO_DOMAIN!;
const recordId = Number.parseInt(process.env.DEMO_RECORD_ID!, 10);
const normalAnswer = "192.0.2.10";
const emergencyAnswer = "192.0.2.11";

const provider = new NameComDnsProvider({
  username: process.env.NAMECOM_USERNAME!,
  apiToken: process.env.NAMECOM_API_TOKEN!,
  ...(process.env.NAMECOM_BASE_URL
    ? { baseUrl: process.env.NAMECOM_BASE_URL }
    : {}),
});

function action(
  preconditionAnswer: string,
  effectAnswer: string,
): DnsRecordAction {
  return {
    version: "action.v1",
    action_type: "dns.record.update",
    resource: {
      provider: "name.com",
      environment: "sandbox",
      domain,
      record_id: recordId,
    },
    precondition: {
      type: "A",
      host: "status",
      answer: preconditionAnswer,
      ttl: 300,
    },
    effect: {
      type: "A",
      host: "status",
      answer: effectAnswer,
      ttl: 300,
    },
  };
}

const before = await provider.getRecord(domain, recordId);
console.log(JSON.stringify({ step: "before", record: before }, null, 2));

await provider.updateRecord(action(normalAnswer, emergencyAnswer));
const emergency = await provider.getRecord(domain, recordId);
console.log(
  JSON.stringify({ step: "after_emergency", record: emergency }, null, 2),
);

await provider.updateRecord(action(emergencyAnswer, normalAnswer));
const restored = await provider.getRecord(domain, recordId);
console.log(
  JSON.stringify({ step: "after_restore", record: restored }, null, 2),
);

if (restored.answer !== normalAnswer) {
  throw new Error(
    `Restore failed: expected ${normalAnswer}, observed ${restored.answer}`,
  );
}

console.log(
  JSON.stringify(
    { step: "result", restored_to: normalAnswer, ok: true },
    null,
    2,
  ),
);
