import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../database/prisma.service';
import { NotificationChannel, OutgoingMessage } from './notification-channel';

/**
 * ELI5: The email adapter. Two modes, chosen by config at boot:
 *
 *  - SMTP_HOST set   → real email via nodemailer (Gmail app password etc.)
 *  - SMTP_HOST blank → "console transport": print the message instead.
 *    Development shouldn't require secrets, and a misconfigured mailer
 *    should degrade to visible logs, not silent nothing.
 *
 * Every attempt — sent, failed, or printed — lands in the delivery_log
 * table. When you wonder "did it actually email me?", the answer is a
 * SELECT, not a feeling.
 */
@Injectable()
export class EmailChannel implements NotificationChannel {
  private readonly logger = new Logger(EmailChannel.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;
  private readonly to: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.from = config.get<string>('ALERT_EMAIL_FROM', '');
    this.to = config.get<string>('ALERT_EMAIL_TO', '');
    const host = config.get<string>('SMTP_HOST', '');

    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: config.get<number>('SMTP_PORT', 587),
          secure: config.get<number>('SMTP_PORT', 587) === 465,
          auth: {
            user: config.get<string>('SMTP_USER', ''),
            pass: config.get<string>('SMTP_PASS', ''),
          },
        })
      : null;

    if (!this.transporter) {
      this.logger.warn('SMTP not configured — emails will print to console');
    }
  }

  async send(message: OutgoingMessage): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        `\n┌─ EMAIL (console mode) ─────────────\n` +
          `│ To:      ${this.to || '(ALERT_EMAIL_TO not set)'}\n` +
          `│ Subject: ${message.subject}\n` +
          `└────────────────────────────────────\n${message.text}`,
      );
      await this.log(message, 'CONSOLE');
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: this.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      await this.log(message, 'SENT');
      this.logger.log(`Emailed: ${message.subject}`);
    } catch (err) {
      await this.log(message, 'FAILED', String(err));
      throw err;
    }
  }

  private log(message: OutgoingMessage, status: 'SENT' | 'FAILED' | 'CONSOLE', error?: string) {
    return this.prisma.deliveryLog.create({
      data: {
        alertEventId: message.alertEventId,
        kind: message.kind,
        recipient: this.to || '(console)',
        subject: message.subject,
        status,
        error,
      },
    });
  }
}
