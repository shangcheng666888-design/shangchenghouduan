-- 管理员谷歌验证器（TOTP）：用于登录时必须校验 6 位动态码
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS totp_secret text;

COMMENT ON COLUMN public.admin_users.totp_secret IS 'TOTP 密钥（base32），用于谷歌验证器校验';
