import { Module } from '@nestjs/common';
import { EmailChannel } from './email.channel';
import { NOTIFICATION_CHANNEL } from './notification-channel';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * The post office. The interesting line is the provider binding below:
 * "when someone asks for NOTIFICATION_CHANNEL, hand them the EmailChannel."
 * Swapping delivery mechanisms is a one-line change HERE — and nowhere else.
 * (A fan-out to multiple channels would just be a CompositeChannel class
 * bound to the same token.)
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    EmailChannel,
    { provide: NOTIFICATION_CHANNEL, useExisting: EmailChannel },
  ],
})
export class NotificationsModule {}
