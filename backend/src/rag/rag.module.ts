import { Module } from "@nestjs/common";
import { RagController } from "@src/rag/rag.controller";
import { RagService } from "@src/rag/rag.service";

@Module({
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
