-- 为 shops 表增加店铺交易密码字段（用于店铺钱包提现/充值的独立支付密码）
alter table if exists shops
  add column if not exists trade_password text;

