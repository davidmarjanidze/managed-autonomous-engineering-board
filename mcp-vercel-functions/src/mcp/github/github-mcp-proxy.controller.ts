import { All, Controller, Logger, Req, Res } from "@nestjs/common";

@Controller("mcp/github")
export class GithubMcpProxyController {
  private readonly logger = new Logger(GithubMcpProxyController.name);

  @All()
  async proxyRoot(@Req() req: any, @Res() res: any): Promise<void> {
    await this.forward(req, res);
  }

  @All("*")
  async proxyAny(@Req() req: any, @Res() res: any): Promise<void> {
    await this.forward(req, res);
  }

  private async forward(req: any, res: any): Promise<void> {
    const upstreamBase = process.env.GITHUB_MCP_UPSTREAM_URL?.trim();
    if (!upstreamBase) {
      res.status(500).json({
        error:
          "GITHUB_MCP_UPSTREAM_URL is required for MCP proxy mode and is not configured.",
      });
      return;
    }

    const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim();
    if (!token) {
      res.status(500).json({
        error:
          "GITHUB_PERSONAL_ACCESS_TOKEN is required for MCP proxy mode and is not configured.",
      });
      return;
    }

    const upstreamUrl = this.resolveUpstreamUrl(req.originalUrl, upstreamBase);
    const method = req.method.toUpperCase();
    const headers = this.buildForwardHeaders(req, token);

    const hasBody = method !== "GET" && method !== "HEAD";
    const rawBody = hasBody ? this.serializeBody(req.body) : undefined;
    if (rawBody !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    try {
      const upstream = await fetch(upstreamUrl, {
        method,
        headers,
        body: rawBody,
      });

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
    } catch (error) {
      this.logger.error(`GitHub MCP proxy request failed: ${String(error)}`);
      res.status(502).json({
        error: "Failed to proxy request to GitHub MCP upstream endpoint.",
      });
    }
  }

  private resolveUpstreamUrl(
    originalUrl: string,
    upstreamBase: string,
  ): string {
    const parsed = new URL(`http://localhost${originalUrl}`);
    const suffixPath = parsed.pathname.replace(/^\/mcp\/github\/?/, "");
    const suffix =
      suffixPath.length > 0 ? `${suffixPath}${parsed.search}` : parsed.search;
    const base = upstreamBase.endsWith("/") ? upstreamBase : `${upstreamBase}/`;
    return new URL(suffix, base).toString();
  }

  private buildForwardHeaders(req: any, token: string): Headers {
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

  private serializeBody(body: unknown): string | undefined {
    if (body === undefined || body === null) {
      return undefined;
    }

    if (typeof body === "string") {
      return body;
    }

    if (typeof body === "object") {
      const keys = Object.keys(body as Record<string, unknown>);
      if (keys.length === 0) {
        return undefined;
      }
      return JSON.stringify(body);
    }

    return String(body);
  }
}
