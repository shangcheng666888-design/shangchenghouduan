-- 确保商品表有供货价字段（若表已存在但无此列则添加）
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS purchase_price numeric;

COMMENT ON COLUMN public.products.purchase_price IS '供货价/采购价（平台给店铺的拿货价），为空时列表显示为未设置';
