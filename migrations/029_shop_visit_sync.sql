CREATE TABLE IF NOT EXISTS shop_daily_visits (
  shop_id TEXT NOT NULL,
  visit_date DATE NOT NULL,
  organic_visits INTEGER NOT NULL DEFAULT 0,
  promotion_visits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, visit_date)
);

CREATE INDEX IF NOT EXISTS idx_shop_daily_visits_shop_date
  ON shop_daily_visits (shop_id, visit_date DESC);

ALTER TABLE shop_paid_promotion_metrics
  ADD COLUMN IF NOT EXISTS visits_synced INTEGER NOT NULL DEFAULT 0;
