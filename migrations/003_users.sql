-- 商城用户表：持久化存储，长期运行依赖数据库
-- 与内存 store 中的 User 字段对应

CREATE TABLE IF NOT EXISTS public.users (
  id           text PRIMARY KEY,              -- 唯一 ID，如 U10001（6 位）
  account      text NOT NULL UNIQUE,           -- 登录账号：邮箱或手机号（含区号）
  password     text NOT NULL,                  -- 登录密码（生产环境应存哈希）
  balance      numeric(12,2) NOT NULL DEFAULT 0,  -- 用户余额（元），与店铺钱包分离
  trade_password text,                        -- 可选，交易/支付密码
  addresses    jsonb NOT NULL DEFAULT '[]',   -- 收货地址列表
  shop_id      text,                          -- 若开店则为店铺 ID，否则 NULL
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_account ON public.users(account);
CREATE INDEX IF NOT EXISTS idx_users_shop_id ON public.users(shop_id);

COMMENT ON TABLE public.users IS '商城用户（买家）账号，持久化存储';

-- 可选：种子测试账号（与 README 一致）
INSERT INTO public.users (id, account, password, balance, addresses, shop_id, created_at)
VALUES ('U10001', 'buyer@test.com', 'abc123', 1000, '[]', NULL, now())
ON CONFLICT (id) DO NOTHING;
