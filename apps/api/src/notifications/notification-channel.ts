/**
 * ELI5: This interface is a SEAM — a deliberate cut line in the design.
 *
 * Everything upstream (alert listener, digest builder) composes a message
 * and hands it to "a channel". It neither knows nor cares whether delivery
 * means SMTP, Telegram, Slack, or a console.log. Add Telegram someday =
 * write one class implementing this interface, register it in the module,
 * change NOTHING upstream. Ports & adapters, hexagonal architecture,
 * "program to interfaces" — all names for this one move.
 *
 * (Why the INJECTION TOKEN? TypeScript interfaces evaporate at compile
 * time — at runtime Nest can't ask "who implements NotificationChannel?".
 * The token is the interface's runtime name tag.)
 */
export const NOTIFICATION_CHANNEL = Symbol('NOTIFICATION_CHANNEL');

export interface OutgoingMessage {
  /** 'alert' | 'digest' — recorded in the delivery log. */
  kind: string;
  subject: string;
  /** Plain-text body (email also gets a simple HTML variant). */
  text: string;
  html?: string;
  /** Links delivery back to an alert event, when there is one. */
  alertEventId?: number;
}

export interface NotificationChannel {
  send(message: OutgoingMessage): Promise<void>;
}
