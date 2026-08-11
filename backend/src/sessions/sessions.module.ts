import { forwardRef, Module } from "@nestjs/common";

import { AgentsModule } from "@src/agents/coordinator";
import { RagModule } from "@src/rag/rag.module";
import { SessionsController } from "@src/sessions/sessions.controller";
import { SessionsService } from "@src/sessions/sessions.service";
import { TasksModule } from "@src/tasks/tasks.module";

@Module({
  imports: [AgentsModule, RagModule, forwardRef(() => TasksModule)],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
