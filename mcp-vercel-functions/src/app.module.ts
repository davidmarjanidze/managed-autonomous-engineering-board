import { Module } from "@nestjs/common";

import { GithubMcpModule } from "./mcp/github/github-mcp.module";

@Module({
  imports: [GithubMcpModule],
})
export class AppModule {}
