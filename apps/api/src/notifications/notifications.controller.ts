import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from './notifications.service';

class AddWatchlistDto {
  @ApiProperty({ example: 'RELIANCE' })
  @IsString()
  symbol!: string;
}

@ApiTags('notifications')
@Controller()
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('notifications/digest/send')
  @ApiOperation({ summary: 'Compose & send the daily digest right now' })
  sendDigestNow() {
    return this.notifications.sendDailyDigest();
  }

  @Get('notifications/deliveries')
  @ApiOperation({ summary: 'Delivery log (did it actually email me?)' })
  deliveries() {
    return this.prisma.deliveryLog.findMany({ orderBy: { id: 'desc' }, take: 50 });
  }

  @Get('watchlist')
  @ApiOperation({ summary: 'Symbols featured in the daily digest' })
  watchlist() {
    return this.prisma.watchlistItem.findMany({ orderBy: { symbol: 'asc' } });
  }

  @Post('watchlist')
  @ApiOperation({ summary: 'Add a symbol to the digest watchlist' })
  add(@Body() dto: AddWatchlistDto) {
    const symbol = dto.symbol.toUpperCase();
    return this.prisma.watchlistItem.upsert({
      where: { symbol },
      create: { symbol },
      update: {},
    });
  }

  @Delete('watchlist/:symbol')
  @ApiOperation({ summary: 'Remove a symbol from the watchlist' })
  async remove(@Param('symbol') symbol: string) {
    await this.prisma.watchlistItem.deleteMany({
      where: { symbol: symbol.toUpperCase() },
    });
    return { removed: symbol.toUpperCase() };
  }
}
