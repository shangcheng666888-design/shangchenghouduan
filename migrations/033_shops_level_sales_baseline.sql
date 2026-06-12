-- 管理员手动干预等级时，记录进度条起跑线（累计销售额快照）
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS level_sales_baseline numeric(12, 2) DEFAULT NULL;

COMMENT ON COLUMN shops.level_sales_baseline IS '管理员手动干预等级时的销售额快照，锁定态进度条从此起跑';

-- 已有锁定店铺：用当前销售额作为基准，避免进度条异常
UPDATE shops
SET level_sales_baseline = COALESCE(sales, 0)
WHERE COALESCE(level_locked, false) = true
  AND level_sales_baseline IS NULL;
