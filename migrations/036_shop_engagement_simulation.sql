-- 店铺每日模拟访客/关注计划（按自然日独立，每天重新生成，非一次性）
CREATE TABLE IF NOT EXISTS shop_daily_engagement_plan (
  shop_id TEXT NOT NULL,
  plan_date DATE NOT NULL,
  target_visits INTEGER NOT NULL,
  target_followers INTEGER NOT NULL,
  delivered_visits INTEGER NOT NULL DEFAULT 0,
  delivered_followers INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, plan_date)
);

CREATE INDEX IF NOT EXISTS idx_shop_daily_engagement_plan_date
  ON shop_daily_engagement_plan (plan_date DESC);

-- 每日模拟访客台账（与 organic/promotion 分开，便于统计）
ALTER TABLE shop_daily_visits
  ADD COLUMN IF NOT EXISTS simulated_visits INTEGER NOT NULL DEFAULT 0;

-- 每日模拟关注台账（用于仪表盘趋势图）
CREATE TABLE IF NOT EXISTS shop_daily_simulated_followers (
  shop_id TEXT NOT NULL,
  follow_date DATE NOT NULL,
  follower_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, follow_date)
);

CREATE INDEX IF NOT EXISTS idx_shop_daily_simulated_followers_date
  ON shop_daily_simulated_followers (follow_date DESC);
