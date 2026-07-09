import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * ELI5: ONE database connection pool for the whole app.
 *
 * This class IS the Prisma client (it extends it), wrapped as a NestJS
 * provider. Because providers are singletons, every service that injects
 * PrismaService shares the same pool — you never want each feature opening
 * its own connections.
 *
 * The lifecycle hooks are the point:
 *  - onModuleInit:    connect while the app is still booting, so a broken
 *                     DATABASE_URL fails the boot (fail fast!) instead of
 *                     failing the first request at 7 PM.
 *  - onModuleDestroy: on shutdown, hand connections back politely.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    // Prisma 7 talks to Postgres through a "driver adapter" — the same
    // battle-tested `pg` driver the rest of the Node world uses.
    super({
      adapter: new PrismaPg({
        connectionString: config.get<string>('DATABASE_URL'),
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
