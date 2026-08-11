import dotenv from "dotenv";
import express, { type Request, type Response } from "express";

dotenv.config();

const app = express();
app.use(express.text({ type: "*/*" }));

app.all("/mcp/github", proxyRequest);
app.all("/mcp/github/*", proxyRequest);
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "github-mcp-proxy" });
});
app.all("*", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

export default function handler(req: Request, res: Response): void {
  app(req, res);
}

function proxyRequest(req: Request, res: Response): void {
  const upstreamBase =
    process.env.GITHUB_MCP_UPSTREAM_URL?.trim() ||
    "https://api.githubcopilot.com/mcp/";
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim();

  if (!token) {
    res.status(500).json({
      error:
        "GITHUB_PERSONAL_ACCESS_TOKEN is not configured for MCP proxy mode.",
    });
    return;
  }

  const upstreamUrl = resolveUpstreamUrl(
    req.originalUrl || req.url,
    upstreamBase,
  );
  const method = req.method.toUpperCase();
  const headers = buildForwardHeaders(req, token);
  const body = shouldSendBody(method) ? String(req.body ?? "") : undefined;

  if (body !== undefined && body.length > 0 && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  void fetch(upstreamUrl, {
    method,
    headers,
    body,
  })
    .then(async (upstream) => {
      res.status(upstream.status);
      for (const [name, value] of upstream.headers.entries()) {
        if (name.toLowerCase() === "transfer-encoding") {
          continue;
        }
        res.setHeader(name, value);
      }

      if (!upstream.body) {
        res.end();
        return;
      }

      const payload = Buffer.from(await upstream.arrayBuffer());
      res.send(payload);
    })
    .catch((error: unknown) => {
      console.error("GitHub MCP proxy request failed:", error);
      res.status(502).json({
        error: "Failed to proxy request to GitHub MCP upstream endpoint.",
      });
    });
}

function resolveUpstreamUrl(originalUrl: string, upstreamBase: string): string {
  const parsed = new URL(`http://localhost${originalUrl}`);
  const suffixPath = parsed.pathname.replace(/^\/mcp\/github\/?/, "");
  const suffix =
    suffixPath.length > 0 ? `${suffixPath}${parsed.search}` : parsed.search;
  const base = upstreamBase.endsWith("/") ? upstreamBase : `${upstreamBase}/`;
  return new URL(suffix, base).toString();
}

function buildForwardHeaders(req: Request, token: string): Headers {
  const headers = new Headers();
  const skipped = new Set([
    "host",
    "content-length",
    "authorization",
    "connection",
  ]);

  for (const [name, value] of Object.entries(req.headers)) {
    if (!value || skipped.has(name.toLowerCase())) {
      continue;
    }

    if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    } else if (typeof value === "string") {
      headers.set(name, value);
    }
  }

  headers.set("authorization", `Bearer ${token}`);
  return headers;
}

function shouldSendBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}
