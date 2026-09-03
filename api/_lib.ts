import type { VercelRequest, VercelResponse } from "@vercel/node";

import { createWarrantApp, type WarrantApp } from "../src/server/app.js";

export async function handle(
  req: VercelRequest,
  res: VercelResponse,
  fn: (app: WarrantApp) => Promise<unknown>,
): Promise<void> {
  try {
    const data = await fn(createWarrantApp(process.env));
    res.status(200).json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
}

export function bodyString(value: unknown): string {
  return String(value ?? "");
}
