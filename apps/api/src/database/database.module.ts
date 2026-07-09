import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * ELI5: @Global() means "every module gets this without importing it".
 * Reserved for truly universal plumbing — config and the database. If we
 * made feature modules global too, the dependency graph would turn to soup:
 * you'd never know who uses what.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
