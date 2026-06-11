ALTER TABLE shop_paid_promotions
  ADD COLUMN IF NOT EXISTS campaign_duration_value INTEGER,
  ADD COLUMN IF NOT EXISTS campaign_duration_unit TEXT;

ALTER TABLE shop_paid_promotions
  DROP CONSTRAINT IF EXISTS shop_paid_promotions_duration_unit_check;

ALTER TABLE shop_paid_promotions
  ADD CONSTRAINT shop_paid_promotions_duration_unit_check
  CHECK (campaign_duration_unit IS NULL OR campaign_duration_unit IN ('minute', 'hour', 'day'));

UPDATE shop_paid_promotions
SET
  campaign_duration_value = campaign_duration_days,
  campaign_duration_unit = 'day'
WHERE campaign_duration_days IS NOT NULL
  AND campaign_duration_value IS NULL;
