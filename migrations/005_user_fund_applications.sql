-- 用户充值/提现申请：提交后待后台审核，通过后才变更余额并记入资金流水
-- 提交时需校验用户交易密码

CREATE TABLE IF NOT EXISTS public.user_fund_applications (
  id            bigserial PRIMARY KEY,
  user_id       text NOT NULL,                    -- 用户 ID
  type          text NOT NULL,                    -- recharge=充值, withdraw=提现
  amount        numeric(12,2) NOT NULL,           -- 金额（正数）
  status        text NOT NULL DEFAULT 'pending',  -- pending=待审核, approved=通过, rejected=拒绝
  created_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz,                      -- 审核时间
  reviewer_id   text,                             -- 审核人（管理员 ID 等）
  remark        text                              -- 驳回原因等备注
);

CREATE INDEX IF NOT EXISTS idx_fund_applications_user_id ON public.user_fund_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_fund_applications_status ON public.user_fund_applications(status);
CREATE INDEX IF NOT EXISTS idx_fund_applications_created_at ON public.user_fund_applications(created_at DESC);

COMMENT ON TABLE public.user_fund_applications IS '用户充值/提现申请，后台审核通过后生效';
