-- CreateEnum
CREATE TYPE "IngestionSource" AS ENUM ('EQUITY_BHAVCOPY', 'INDEX_SNAPSHOT', 'CORPORATE_ACTIONS');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CorporateActionType" AS ENUM ('SPLIT', 'BONUS', 'DIVIDEND', 'OTHER');

-- CreateEnum
CREATE TYPE "AlertTargetType" AS ENUM ('STOCK', 'INDEX');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SENT', 'FAILED', 'CONSOLE');

-- CreateTable
CREATE TABLE "instruments" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "series" TEXT NOT NULL DEFAULT 'EQ',
    "isin" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading_holidays" (
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "trading_holidays_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "eod_prices" (
    "symbol" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "open" DECIMAL(14,4) NOT NULL,
    "high" DECIMAL(14,4) NOT NULL,
    "low" DECIMAL(14,4) NOT NULL,
    "close" DECIMAL(14,4) NOT NULL,
    "prev_close" DECIMAL(14,4),
    "volume" BIGINT NOT NULL,
    "turnover" DECIMAL(20,2),
    "total_trades" INTEGER,
    "ingestion_run_id" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "superseded_at" TIMESTAMPTZ(6),

    CONSTRAINT "eod_prices_pkey" PRIMARY KEY ("symbol","series","trade_date","revision")
);

-- CreateTable
CREATE TABLE "index_values" (
    "index_name" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "close" DECIMAL(14,2) NOT NULL,
    "open" DECIMAL(14,2),
    "high" DECIMAL(14,2),
    "low" DECIMAL(14,2),
    "pe" DECIMAL(8,2),
    "pb" DECIMAL(8,2),
    "div_yield" DECIMAL(6,2),
    "ingestion_run_id" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "superseded_at" TIMESTAMPTZ(6),

    CONSTRAINT "index_values_pkey" PRIMARY KEY ("index_name","trade_date","revision")
);

-- CreateTable
CREATE TABLE "ingestion_runs" (
    "id" SERIAL NOT NULL,
    "source" "IngestionSource" NOT NULL,
    "trade_date" DATE NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "file_hash" TEXT,
    "row_count" INTEGER,
    "error" TEXT,

    CONSTRAINT "ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_actions" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "series" TEXT NOT NULL DEFAULT 'EQ',
    "ex_date" DATE NOT NULL,
    "purpose" TEXT NOT NULL,
    "action_type" "CorporateActionType" NOT NULL,
    "ratio_new" DECIMAL(14,4),
    "ratio_old" DECIMAL(14,4),
    "dividend_amount" DECIMAL(14,4),
    "ingestion_run_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corporate_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustment_factors" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "ex_date" DATE NOT NULL,
    "factor" DECIMAL(20,10) NOT NULL,
    "action_id" INTEGER,

    CONSTRAINT "adjustment_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "target_type" "AlertTargetType" NOT NULL,
    "symbol" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "cooldown_days" INTEGER NOT NULL DEFAULT 7,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" SERIAL NOT NULL,
    "rule_id" INTEGER NOT NULL,
    "triggered_on" DATE NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_log" (
    "id" SERIAL NOT NULL,
    "alert_event_id" INTEGER,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist" (
    "symbol" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_pkey" PRIMARY KEY ("symbol")
);

-- CreateIndex
CREATE UNIQUE INDEX "instruments_symbol_series_key" ON "instruments"("symbol", "series");

-- CreateIndex
CREATE INDEX "eod_prices_trade_date_idx" ON "eod_prices"("trade_date");

-- CreateIndex
CREATE INDEX "ingestion_runs_source_trade_date_idx" ON "ingestion_runs"("source", "trade_date");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_actions_symbol_ex_date_purpose_key" ON "corporate_actions"("symbol", "ex_date", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "adjustment_factors_symbol_ex_date_key" ON "adjustment_factors"("symbol", "ex_date");

-- CreateIndex
CREATE UNIQUE INDEX "alert_events_rule_id_triggered_on_key" ON "alert_events"("rule_id", "triggered_on");

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_log" ADD CONSTRAINT "delivery_log_alert_event_id_fkey" FOREIGN KEY ("alert_event_id") REFERENCES "alert_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written Timescale section (Prisma generated everything above; it has
-- no vocabulary for hypertables, so we drop to raw SQL — the ORM escape hatch)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Physically partition eod_prices into one chunk per month of trade_date.
-- Queries on a date range only touch the chunks inside that range.
SELECT create_hypertable('eod_prices', by_range('trade_date', INTERVAL '1 month'));
