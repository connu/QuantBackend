/**
 * ELI5: Instead of the ingestion module calling the alerts module directly
 * ("evaluate now!"), it shouts into the room: "day X is ingested!" — and
 * whoever cares can listen. Ingestion doesn't know alerts exist; alerts
 * don't know how ingestion works. Loose coupling via events.
 */
export const INGESTION_COMPLETED = 'ingestion.completed';

export class IngestionCompletedEvent {
  constructor(
    /** 'YYYY-MM-DD' */
    public readonly tradeDate: string,
    /** How many equity price rows landed (0 = skipped/failed). */
    public readonly equityRows: number,
    /** How many index rows landed. */
    public readonly indexRows: number,
  ) {}
}
