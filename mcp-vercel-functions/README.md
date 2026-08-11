# mcp-vercel-functions

Standalone NestJS app deployed as Vercel Functions to expose a public GitHub MCP proxy endpoint for Anthropic-managed agents.

## Endpoint

- GitHub MCP proxy route: `/mcp/github`
- Anthropic should be configured to call: `https://<your-domain>/mcp/github/`

## Environment variables

- `GITHUB_MCP_UPSTREAM_URL` (required): upstream MCP server URL, typically `https://api.githubcopilot.com/mcp/`
- `GITHUB_PERSONAL_ACCESS_TOKEN` (required): token injected as `Authorization: Bearer <token>`
- `PORT` (optional): local dev port

## Local development

1. `cp .env.example .env`
2. fill values
3. `npm install`
4. `npm run start:dev`

## Vercel deployment

1. Set project root in Vercel to `mcp-vercel-functions`
2. Configure env vars in Vercel Project Settings:

- `GITHUB_MCP_UPSTREAM_URL`
- `GITHUB_PERSONAL_ACCESS_TOKEN`

3. Deploy and copy the assigned public domain

## Backend wiring

In the repository root `.env`, set:

- `GITHUB_MCP_DOMAIN=<your-vercel-domain>`

The backend resolves this to:

- `https://<your-vercel-domain>/mcp/github/`

You can also set `GITHUB_MCP_SERVER_URL` directly to override domain resolution.
