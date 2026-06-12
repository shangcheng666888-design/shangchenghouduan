-- 店铺等级：销售额自动升级 + 管理员手动锁定
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS level_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN shops.level_locked IS 'true 表示管理员手动设置过等级，暂停按销售额自动升降';

-- 对未锁定店铺，按累计销售额回填等级
UPDATE shops
SET level = CASE
  WHEN COALESCE(sales, 0) >= 100000 THEN 4
  WHEN COALESCE(sales, 0) >= 50000 THEN 3
  WHEN COALESCE(sales, 0) >= 10000 THEN 2
  ELSE 1
END
WHERE COALESCE(level_locked, false) = false;
