import { NestFactory } from "@nestjs/core";
import dotenv from "dotenv";
import "reflect-metadata";

import { configureApp } from "./app-setup";
import { AppModule } from "./app.module";

dotenv.config();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  configureApp(app);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
