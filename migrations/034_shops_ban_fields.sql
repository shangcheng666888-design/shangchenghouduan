-- 店铺封禁：原因、说明、时间与操作人
ALTER TABLE shops ADD COLUMN IF NOT EXISTS ban_reason text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS ban_notice text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS banned_at timestamptz;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS banned_by text;
