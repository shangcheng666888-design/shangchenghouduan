-- 店铺推荐表：商家在「我的商品」中点击点赞后，商品加入推荐表，商城店铺页「推荐」区域展示
CREATE TABLE IF NOT EXISTS public.shop_recommendations (
  shop_id    text NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  listing_id text NOT NULL,  -- shop_products.id
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_recommendations_shop_id ON public.shop_recommendations(shop_id);
COMMENT ON TABLE public.shop_recommendations IS '店铺推荐商品表，listing_id 对应 shop_products.id';
