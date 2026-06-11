ALTER TABLE shop_paid_promotions
  DROP CONSTRAINT IF EXISTS shop_paid_promotions_status_check;

ALTER TABLE shop_paid_promotions
  ADD CONSTRAINT shop_paid_promotions_status_check
  CHECK (status IN ('pending', 'awaiting_launch', 'active', 'paused', 'ended', 'completed'));

ALTER TABLE shop_paid_promotions
  ADD COLUMN IF NOT EXISTS target_region TEXT,
  ADD COLUMN IF NOT EXISTS target_audience TEXT,
  ADD COLUMN IF NOT EXISTS merchant_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS campaign_duration_days INTEGER,
  ADD COLUMN IF NOT EXISTS budget_total NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS preset_impressions INTEGER,
  ADD COLUMN IF NOT EXISTS preset_clicks INTEGER,
  ADD COLUMN IF NOT EXISTS preset_visits INTEGER,
  ADD COLUMN IF NOT EXISTS preset_orders INTEGER,
  ADD COLUMN IF NOT EXISTS preset_revenue NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS campaign_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS campaign_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_seed INTEGER;

ALTER TABLE shop_paid_promotion_metrics
  ADD COLUMN IF NOT EXISTS planned_impressions INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planned_clicks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planned_visits INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planned_orders INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planned_spend NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planned_revenue NUMERIC(18,2) NOT NULL DEFAULT 0;
