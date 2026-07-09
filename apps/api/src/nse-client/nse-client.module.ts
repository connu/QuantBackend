import { Module } from '@nestjs/common';
import { NseHttpService } from './nse-http.service';

/**
 * ELI5: This module exists to enforce a boundary: talking to NSE is ITS
 * job, and everyone else must go through its exported service. If NSE
 * changes headers/limits tomorrow, exactly one file changes.
 */
@Module({
  providers: [NseHttpService],
  exports: [NseHttpService],
})
export class NseClientModule {}
