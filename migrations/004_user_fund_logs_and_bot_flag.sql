-- 1) 用户表增加「是否机器人」标识：真实用户 vs 平台自建机器人
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.is_bot IS 'true=平台机器人，false=真实用户';

-- 2) 用户资金变动记录表：充值、提现、消费（下单扣款）、退款等，供个人中心展示
CREATE TABLE IF NOT EXISTS public.user_fund_logs (
  id            bigserial PRIMARY KEY,
  user_id       text NOT NULL,                    -- 用户 ID
  type          text NOT NULL,                    -- recharge=充值, withdraw=提现, consume=消费(下单), refund=退款
  amount        numeric(12,2) NOT NULL,             -- 金额：正数=收入，负数=支出（或按 type 约定）
  balance_after  numeric(12,2),                    -- 变动后余额（便于对账）
  related_id    text,                              -- 关联单号：订单号、提现单号等
  remark        text,                              -- 备注
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_fund_logs_user_id ON public.user_fund_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_fund_logs_type ON public.user_fund_logs(type);
CREATE INDEX IF NOT EXISTS idx_user_fund_logs_created_at ON public.user_fund_logs(created_at DESC);

COMMENT ON TABLE public.user_fund_logs IS '用户资金变动记录：充值、提现、消费、退款，个人中心展示';
