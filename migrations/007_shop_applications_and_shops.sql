-- 商家入驻申请表：提交后待管理员审核，审核通过后创建店铺与商家账号
CREATE TABLE IF NOT EXISTS public.shop_applications (
  id            text PRIMARY KEY,                  -- 申请单 ID，如 SA10001
  store_name    text NOT NULL,
  store_address text NOT NULL,
  country       text NOT NULL,
  id_number     text NOT NULL,
  real_name     text NOT NULL,
  email         text NOT NULL,
  password      text NOT NULL,                      -- 审核通过后用于创建商家登录账号
  invitation_code text NOT NULL DEFAULT '',
  logo          text,                              -- 店铺标志图（data URL 或 URL）
  id_front      text,                              -- 证件正面
  id_back       text,                              -- 证件反面
  id_handheld   text,                              -- 手持证件照
  signature     text,                              -- 乙方签名图
  status        text NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_applications_status ON public.shop_applications(status);
CREATE INDEX IF NOT EXISTS idx_shop_applications_created_at ON public.shop_applications(created_at DESC);
COMMENT ON TABLE public.shop_applications IS '商家入驻申请，审核通过后开通店铺';

-- 店铺表：审核通过后创建，与 users.shop_id 关联
CREATE TABLE IF NOT EXISTS public.shops (
  id              text PRIMARY KEY,                -- 店铺 ID，如 S10001
  name            text NOT NULL,
  owner_id        text NOT NULL,                    -- 对应用户 id（users.id）
  status          text NOT NULL DEFAULT 'normal',  -- normal | banned
  credit_score    numeric(5,2) NOT NULL DEFAULT 100,
  wallet_balance  numeric(12,2) NOT NULL DEFAULT 0,
  level           int NOT NULL DEFAULT 1,
  followers       int NOT NULL DEFAULT 0,
  sales           int NOT NULL DEFAULT 0,
  good_rate       numeric(5,2) NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_owner_id ON public.shops(owner_id);
CREATE INDEX IF NOT EXISTS idx_shops_status ON public.shops(status);
COMMENT ON TABLE public.shops IS '已开通店铺，owner_id 关联 users.id';
