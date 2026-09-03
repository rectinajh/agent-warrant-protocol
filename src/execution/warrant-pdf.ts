import type { IssuedWarrant } from "../protocol/schema.js";

function pdfEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Renders a minimal, signable warrant PDF.
 *
 * The page prints the executable fields plus both digests and embeds the Foxit
 * eSign Text Tags (`signfield` / `datefield`) for party 1. Foxit converts the
 * tags into interactive fields when `processTextTags` is enabled on the folder.
 */
export function renderWarrantPdf(warrant: IssuedWarrant): Uint8Array {
  const lines = [
    `Agent Warrant ${warrant.authorization.warrant_id}`,
    `Version: ${warrant.authorization.version}`,
    `Agent: ${warrant.authorization.agent_id}`,
    `Action: ${warrant.action.action_type}`,
    `Domain: ${warrant.action.resource.domain}`,
    `Record ID: ${warrant.action.resource.record_id}`,
    `Precondition: ${warrant.action.precondition.type} ${warrant.action.precondition.host} ${warrant.action.precondition.answer} TTL ${warrant.action.precondition.ttl}`,
    `Effect: ${warrant.action.effect.type} ${warrant.action.effect.host} ${warrant.action.effect.answer} TTL ${warrant.action.effect.ttl}`,
    `Signer email hash: ${warrant.authorization.signer_email_hash}`,
    `Expires: ${warrant.authorization.expires_at}`,
    `Action digest: ${warrant.authorization.action_digest}`,
    `Warrant digest: ${warrant.warrant_digest}`,
    "",
    "Signature:",
    "${signfield:1:y:______}",
    "Date:",
    "${datefield:1:y::______}",
  ];

  let content = "";
  let y = 720;
  for (const line of lines) {
    content += `BT /F1 12 Tf 72 ${y} Td (${pdfEscape(line)}) Tj ET\n`;
    y -= 20;
  }

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}
