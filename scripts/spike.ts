import { NameComDnsProvider } from "../src/providers/namecom.js";

const required = [
  "FOXIT_CLIENT_ID",
  "FOXIT_CLIENT_SECRET",
  "FOXIT_ESIGN_HOST",
  "NAMECOM_USERNAME",
  "NAMECOM_API_TOKEN",
  "DEMO_DOMAIN",
  "DEMO_RECORD_ID",
  "XANO_API_BASE_URL",
  "XANO_API_TOKEN",
  "MODEL_API_KEY",
  "MODEL_NAME",
] as const;

const missing = required.filter((key) => !process.env[key]);

console.log(
  JSON.stringify(
    {
      gate: "provider-credentials",
      ready: missing.length === 0,
      present: required.filter((key) => Boolean(process.env[key])),
      missing,
    },
    null,
    2,
  ),
);

if (missing.length > 0) {
  console.error(
    "Spike blocked: copy .env.example to .env and provide the missing values.",
  );
  process.exitCode = 1;
} else {
  const recordId = Number.parseInt(process.env.DEMO_RECORD_ID!, 10);
  if (!Number.isSafeInteger(recordId) || recordId <= 0) {
    throw new Error("DEMO_RECORD_ID must be a positive integer");
  }

  const provider = new NameComDnsProvider({
    username: process.env.NAMECOM_USERNAME!,
    apiToken: process.env.NAMECOM_API_TOKEN!,
    ...(process.env.NAMECOM_BASE_URL
      ? { baseUrl: process.env.NAMECOM_BASE_URL }
      : {}),
  });
  const record = await provider.getRecord(process.env.DEMO_DOMAIN!, recordId);
  console.log(
    JSON.stringify(
      {
        gate: "namecom-read",
        ready: true,
        record,
      },
      null,
      2,
    ),
  );
  console.error(
    "Foxit and Xano are now exercised live by the operator flow (pnpm serve) and the e2e demo (scripts/e2e-demo.ts).",
  );
  process.exitCode = 0;
}
