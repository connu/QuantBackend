import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';

/**
 * ELI5: A NestJS app is a tree of Modules, and this is the root of the tree.
 *
 * A Module is just a labelled box of related code. Each box declares:
 *   - controllers: classes that answer HTTP requests (the "front desk")
 *   - providers:   classes that do actual work (services, workers, ...)
 *   - imports:     other boxes whose contents this box wants to use
 *
 * Nest reads these declarations at boot and wires everything together via
 * "dependency injection": if a class says it needs a ConfigService in its
 * constructor, Nest constructs one and hands it over. Nobody ever writes
 * `new ConfigService()` by hand — that's the whole trick. It keeps classes
 * loosely coupled and trivially swappable in tests.
 *
 * As the project grows, each feature (ingestion, alerts, ...) gets its own
 * module imported here.
 */
@Module({
  imports: [
    // isGlobal: every module can inject ConfigService without re-importing.
    // validate: the bouncer from env.validation.ts — bad config = no boot.
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // Our .env lives at the repo root, two levels above apps/api.
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
