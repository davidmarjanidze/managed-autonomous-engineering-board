import { forwardRef, Module } from "@nestjs/common";

import { SessionsModule } from "@src/sessions/sessions.module";
import { ApprovalGateService } from "@src/tasks/approval-gate.service";
import { StateStoreService } from "@src/tasks/state-store.service";
import { TasksController } from "@src/tasks/tasks.controller";
import { TasksService } from "@src/tasks/tasks.service";

@Module({
  imports: [forwardRef(() => SessionsModule)],
  controllers: [TasksController],
  providers: [TasksService, ApprovalGateService, StateStoreService],
  exports: [TasksService],
})
export class TasksModule {}
