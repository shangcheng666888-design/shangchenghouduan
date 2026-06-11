CREATE TABLE IF NOT EXISTS shop_paid_promotions (
  id BIGSERIAL PRIMARY KEY,
  shop_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('tiktok', 'meta', 'google', 'other')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'ended')),
  target_type TEXT CHECK (target_type IS NULL OR target_type IN ('shop', 'product')),
  target_listing_id TEXT,
  admin_note TEXT,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_paid_promotions_shop_status
  ON shop_paid_promotions (shop_id, status);

CREATE INDEX IF NOT EXISTS idx_shop_paid_promotions_status_created
  ON shop_paid_promotions (status, created_at DESC);

CREATE TABLE IF NOT EXISTS shop_paid_promotion_metrics (
  id BIGSERIAL PRIMARY KEY,
  promotion_id BIGINT NOT NULL REFERENCES shop_paid_promotions(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0,
  spend NUMERIC(18,2) NOT NULL DEFAULT 0,
  revenue NUMERIC(18,2) NOT NULL DEFAULT 0,
  UNIQUE (promotion_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_shop_paid_promotion_metrics_promotion_date
  ON shop_paid_promotion_metrics (promotion_id, metric_date DESC);
