import { config } from "dotenv";
import { join } from "node:path";
import "reflect-metadata";
config({ path: join(__dirname, "../../.env") });

import { NestFactory } from "@nestjs/core";
import { AppModule } from "@src/app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    cors: true,
  });

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
