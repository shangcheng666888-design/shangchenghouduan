-- 商城首页推荐产品：管理员设置某店铺的某件商品在首页「推荐产品」栏展示
CREATE TABLE IF NOT EXISTS public.mall_featured_products (
  id         serial PRIMARY KEY,
  shop_id    text NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shop_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_mall_featured_products_order ON public.mall_featured_products(sort_order, id);
COMMENT ON TABLE public.mall_featured_products IS '商城首页推荐产品';

-- 商城首页推荐店铺
CREATE TABLE IF NOT EXISTS public.mall_featured_shops (
  id         serial PRIMARY KEY,
  shop_id    text NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shop_id)
);
CREATE INDEX IF NOT EXISTS idx_mall_featured_shops_order ON public.mall_featured_shops(sort_order, id);
COMMENT ON TABLE public.mall_featured_shops IS '商城首页推荐店铺';

-- 商城首页热销推荐：管理员设置的热销商品
CREATE TABLE IF NOT EXISTS public.mall_hot_products (
  id         serial PRIMARY KEY,
  shop_id    text NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shop_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_mall_hot_products_order ON public.mall_hot_products(sort_order, id);
COMMENT ON TABLE public.mall_hot_products IS '商城首页热销推荐';
