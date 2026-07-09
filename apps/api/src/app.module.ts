import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { BackfillModule } from './backfill/backfill.module';
import { CorporateActionsModule } from './corporate-actions/corporate-actions.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { MarketDataModule } from './market-data/market-data.module';

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

    // ScheduleModule discovers every @Cron decorator in the app and arms it.
    ScheduleModule.forRoot(),

    // In-process pub/sub — how "ingestion finished" reaches the alert
    // evaluator without those modules knowing about each other.
    EventEmitterModule.forRoot(),

    // ONE Redis connection config for every queue in the app.
    // forRootAsync + inject: we can't hardcode the host — it comes from the
    // validated env, so we ask the DI container to hand us ConfigService.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST'),
          port: config.get<number>('REDIS_PORT'),
        },
      }),
    }),

    IngestionModule,
    BackfillModule,
    CorporateActionsModule,
    MarketDataModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
