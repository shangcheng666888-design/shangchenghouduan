-- 充值申请：支持上传交易截图 URL（与交易号二选一或并存，前端改为只传截图）
ALTER TABLE IF EXISTS user_fund_applications
  ADD COLUMN IF NOT EXISTS recharge_screenshot_url TEXT;

ALTER TABLE IF EXISTS shop_fund_applications
  ADD COLUMN IF NOT EXISTS recharge_screenshot_url TEXT;

COMMENT ON COLUMN user_fund_applications.recharge_screenshot_url IS '用户上传的交易截图公网 URL';
COMMENT ON COLUMN shop_fund_applications.recharge_screenshot_url IS '店铺充值上传的交易截图公网 URL';
