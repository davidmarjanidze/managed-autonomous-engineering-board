import { Module } from "@nestjs/common";

import { GithubMcpProxyController } from "./github-mcp-proxy.controller";

@Module({
  controllers: [GithubMcpProxyController],
})
export class GithubMcpModule {}
