-- 为 shops 表增加最近登录 IP 与国家字段，用于在后台店铺管理中展示

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS last_login_ip text,
  ADD COLUMN IF NOT EXISTS last_login_country text;

