-- 为平台统一收款配置增加多网络地址字段（ETH、BTC、USDT-TRC20）
ALTER TABLE IF EXISTS public.platform_payment_config
  ADD COLUMN IF NOT EXISTS eth_address   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS btc_address   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS trc20_address text NOT NULL DEFAULT '';

