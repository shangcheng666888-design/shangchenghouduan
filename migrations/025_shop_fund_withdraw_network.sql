-- 店铺提现申请：记录区块链网络（TRC20 / ERC20）
ALTER TABLE IF EXISTS public.shop_fund_applications
  ADD COLUMN IF NOT EXISTS withdraw_network text;

COMMENT ON COLUMN public.shop_fund_applications.withdraw_network IS '提现网络：TRC20 | ERC20';
