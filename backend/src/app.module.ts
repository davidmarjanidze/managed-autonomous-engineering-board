import { Module } from "@nestjs/common";

import { AgentsModule } from "@src/agents/coordinator";
import { RagModule } from "@src/rag/rag.module";
import { SessionsModule } from "@src/sessions/sessions.module";
import { TasksModule } from "@src/tasks/tasks.module";

@Module({
  imports: [AgentsModule, RagModule, SessionsModule, TasksModule],
})
export class AppModule {}
