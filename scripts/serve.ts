import { readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createWarrantApp } from "../src/server/app.js";

const port = Number(process.env.PORT ?? 3000);
const app = createWarrantApp(process.env);

const htmlPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/index.html",
);
const html = readFileSync(htmlPath, "utf8");

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );

  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/propose") {
      const body = await readJson(req);
      sendJson(res, 200, await app.propose(String(body.request ?? "")));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/issue") {
      const body = await readJson(req);
      sendJson(res, 200, await app.issue(String(body.request ?? "")));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/execute") {
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await app.execute(
          String(body.warrant_id ?? ""),
          String(body.envelope_id ?? ""),
        ),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/replay") {
      sendJson(
        res,
        200,
        await app.replay(url.searchParams.get("warrant_id") ?? ""),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(
        res,
        200,
        await app.status(url.searchParams.get("warrant_id") ?? ""),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/current") {
      sendJson(res, 200, await app.current());
      return;
    }

    const envelopeStatus = url.pathname.match(
      /^\/api\/envelope\/([^/]+)\/status$/,
    );
    if (req.method === "GET" && envelopeStatus) {
      sendJson(res, 200, await app.envelopeStatus(envelopeStatus[1] ?? ""));
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { error: message });
  }
});

server.listen(port, () => {
  console.log(
    `Agent Warrant operator UI listening on http://localhost:${port}`,
  );
});
