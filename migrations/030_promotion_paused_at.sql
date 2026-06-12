ALTER TABLE shop_paid_promotions
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_accumulated_ms BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_shop_paid_promotions_paused_at
  ON shop_paid_promotions (paused_at)
  WHERE paused_at IS NOT NULL;
