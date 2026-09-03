import type { VercelRequest, VercelResponse } from "@vercel/node";

import { bodyString, handle } from "./_lib.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await handle(req, res, (app) => app.propose(bodyString(req.body?.request)));
}
