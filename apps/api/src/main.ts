import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

/**
 * ELI5: This is the ignition key. It builds the whole app from the root
 * module (AppModule), bolts on a few app-wide behaviors, and starts
 * listening for HTTP requests. Everything else in the project hangs off
 * the module tree that starts at AppModule.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Every incoming request body gets checked against its DTO class.
  // whitelist: silently drop any fields we didn't declare (no smuggling).
  // transform: convert raw JSON into real class instances with real types.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  // Let the (future) dashboard on another port call this API.
  app.enableCors();

  // Swagger: auto-generated, clickable API docs at /api/docs.
  // Nest reads our decorators (@ApiTags, @Get, DTOs...) to build the page.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('MarketPulse API')
    .setDescription('NSE market data ingestion + alert engine')
    .setVersion('0.1')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // ConfigService hands us the validated env from env.validation.ts.
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);

  // Bind to loopback only: this API has no authentication (it's a personal
  // localhost tool), so it must never be reachable from the LAN/café wifi.
  await app.listen(port, '127.0.0.1');
  console.log(`MarketPulse API up on http://localhost:${port}`);
  console.log(`Swagger docs at     http://localhost:${port}/api/docs`);
}

void bootstrap();
