import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * ELI5: A Controller is the front desk — it maps URLs to methods.
 *
 * @Controller('health') means "I own everything under /health".
 * @Get() on a method means "GET requests land here".
 * Whatever the method returns is serialized to JSON automatically.
 */
@ApiTags('health')
@Controller('health')
export class AppController {
  @Get()
  @ApiOperation({ summary: 'Liveness check — is the API up?' })
  getHealth() {
    return {
      status: 'ok',
      service: 'marketpulse-api',
      time: new Date().toISOString(),
    };
  }
}
