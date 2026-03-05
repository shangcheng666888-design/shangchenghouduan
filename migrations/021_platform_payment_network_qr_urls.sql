-- 平台统一收款配置：为 ETH / BTC / USDT‑TRC20 增加独立二维码字段
ALTER TABLE IF EXISTS public.platform_payment_config
  ADD COLUMN IF NOT EXISTS eth_qr_url   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS btc_qr_url   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS trc20_qr_url text NOT NULL DEFAULT '';

