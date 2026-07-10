/** Fired after evaluation when at least one rule triggered. */
export const ALERTS_TRIGGERED = 'alerts.triggered';

export interface TriggeredAlert {
  eventId: number;
  ruleId: number;
  ruleName: string;
  symbol: string;
  tradeDate: string;
  /** Human-readable explanation, e.g. "close 3050.10 crossed above sma(200) 2987.44" */
  reasons: string[];
}

export class AlertsTriggeredEvent {
  constructor(public readonly alerts: TriggeredAlert[]) {}
}
