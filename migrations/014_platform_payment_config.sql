-- 平台统一收款配置：仅一条记录，供商城充值与店铺充值展示收款地址与收款二维码

CREATE TABLE IF NOT EXISTS public.platform_payment_config (
  id              serial PRIMARY KEY,
  receive_address text NOT NULL DEFAULT '',   -- 收款地址
  receive_qr_url  text NOT NULL DEFAULT ''   -- 收款二维码图片 URL（管理员上传后保存）
);

COMMENT ON TABLE public.platform_payment_config IS '平台统一收款：收款地址与收款二维码，商城/店铺充值页均读此表';

-- 确保有一条默认记录（仅当表为空时插入）
INSERT INTO public.platform_payment_config (id, receive_address, receive_qr_url)
SELECT 1, '', '' WHERE NOT EXISTS (SELECT 1 FROM public.platform_payment_config LIMIT 1);
