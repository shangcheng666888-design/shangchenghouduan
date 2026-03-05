-- 管理员后台登录：独立表，与商城用户表 users 分离
-- 仅用于 /admin 后台登录校验

CREATE TABLE IF NOT EXISTS public.admin_users (
  id           serial PRIMARY KEY,
  username     text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_username ON public.admin_users(username);

COMMENT ON TABLE public.admin_users IS '管理员后台账号，仅用于 /admin 登录';

-- 初始管理员账号：fafa2026 / yilufafafa（密码已用与 backend 相同的 scrypt 盐哈希）
INSERT INTO public.admin_users (username, password_hash)
VALUES (
  'fafa2026',
  'f5bbe8742df0d87c2fd212183bd1a85c89547ce9c7f082aee10812605ca3f371727c3ab4f7c46430709bd8447d3097a49c8e07171a8a0847f0112eff178a4d24'
)
ON CONFLICT (username) DO NOTHING;
