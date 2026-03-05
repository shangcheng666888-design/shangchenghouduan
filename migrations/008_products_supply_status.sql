-- 商品供货状态：on=可被店铺采购，off=下架后店铺不可见
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supply_status text NOT NULL DEFAULT 'on';

CREATE INDEX IF NOT EXISTS idx_products_supply_status ON public.products(supply_status);
COMMENT ON COLUMN public.products.supply_status IS 'on=供货中(店铺可见), off=已下架(店铺不可采购)';
