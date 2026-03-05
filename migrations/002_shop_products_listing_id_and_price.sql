-- 每条「店铺-商品」上架记录有独立 ID；支持每店独立定价（同一商品多店不同价）

ALTER TABLE public.shop_products
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS price numeric;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_products_listing_id ON public.shop_products(id);

COMMENT ON COLUMN public.shop_products.id IS '上架记录唯一 ID，商城展示与下单用';
COMMENT ON COLUMN public.shop_products.price IS '店铺自定义售价，为空则用商品表 selling_price';
