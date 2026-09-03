import type { VercelRequest, VercelResponse } from "@vercel/node";

import { handle } from "./_lib.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await handle(req, res, (app) =>
    app.status(String(req.query.warrant_id ?? "")),
  );
}
