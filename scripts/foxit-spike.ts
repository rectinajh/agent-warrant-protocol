const clientId = process.env.FOXIT_CLIENT_ID;
const clientSecret = process.env.FOXIT_CLIENT_SECRET;
const host = process.env.FOXIT_ESIGN_HOST ?? "https://na1.fusion.foxit.com";
const signerEmail = process.env.FOXIT_SIGNER_EMAIL ?? "rectinajh@gmail.com";

if (!clientId || !clientSecret) {
  console.error(
    "Foxit spike blocked: provide FOXIT_CLIENT_ID and FOXIT_CLIENT_SECRET.",
  );
  process.exit(1);
}

// Mirrors Foxit's official eSign starter request: URL-based sample PDF, draft,
// embedded signing session for the configured signer.
const response = await fetch(
  `${host.replace(/\/$/, "")}/esign/api/v1/folders/createfolder`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      client_id: clientId,
      client_secret: clientSecret,
    },
    body: JSON.stringify({
      folderName: "agent-warrant-foxit-spike",
      inputType: "url",
      fileUrls: [
        "https://app.developer-api.foxit.com/esign/foxit-esign-api-sample.pdf",
      ],
      fileNames: ["Foxit eSign Contract.pdf"],
      processTextTags: true,
      processAcroFields: false,
      createEmbeddedSigningSession: true,
      embeddedSignersEmailIds: [signerEmail],
      sendNow: false,
      parties: [
        {
          firstName: "Operator",
          lastName: "Signer",
          emailId: signerEmail,
          permission: "FILL_FIELDS_AND_SIGN",
          sequence: 1,
        },
      ],
    }),
  },
);

const payload = (await response.json()) as {
  folder?: { folderId?: number | string; folderStatus?: string };
  embeddedSigningSessions?: Array<{ embeddedSessionURL?: string }>;
  result?: string;
  message?: string;
};

if (
  !response.ok ||
  payload.folder?.folderId === undefined ||
  !payload.embeddedSigningSessions?.[0]?.embeddedSessionURL
) {
  console.error(
    JSON.stringify(
      {
        gate: "foxit-embedded-session",
        ready: false,
        status: response.status,
        error: payload,
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

console.log(
  JSON.stringify(
    {
      gate: "foxit-embedded-session",
      ready: true,
      folder_id: payload.folder.folderId,
      folder_status: payload.folder.folderStatus,
      signing_url: payload.embeddedSigningSessions[0].embeddedSessionURL,
    },
    null,
    2,
  ),
);
