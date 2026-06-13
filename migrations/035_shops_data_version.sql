-- 店铺数据版本号：用于商家端轻量 sync 轮询与 SSE 推送
ALTER TABLE shops ADD COLUMN IF NOT EXISTS data_version bigint NOT NULL DEFAULT 1;
