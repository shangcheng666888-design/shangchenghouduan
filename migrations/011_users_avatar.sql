-- 商城用户头像：用户从头像列表中选中的头像 URL，登录后固定显示
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar text;

COMMENT ON COLUMN public.users.avatar IS '用户选择的头像 URL，对应头像列表中的路径';
