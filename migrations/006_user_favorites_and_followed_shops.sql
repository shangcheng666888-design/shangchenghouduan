-- 用户商品收藏：点击商品卡片五角星加入/取消收藏，持久化
CREATE TABLE IF NOT EXISTS public.user_product_favorites (
  id         bigserial PRIMARY KEY,
  user_id    text NOT NULL,
  item_id    text NOT NULL,                   -- 商品/上架 ID（卡片 id）
  title      text,
  image      text,
  price      text,
  subtitle   text,
  shop_id    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_product_favorites_user_id ON public.user_product_favorites(user_id);

COMMENT ON TABLE public.user_product_favorites IS '用户收藏的商品（含快照便于列表展示）';

-- 用户关注店铺
CREATE TABLE IF NOT EXISTS public.user_followed_shops (
  id         bigserial PRIMARY KEY,
  user_id    text NOT NULL,
  shop_id    text NOT NULL,
  shop_name  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, shop_id)
);

CREATE INDEX IF NOT EXISTS idx_user_followed_shops_user_id ON public.user_followed_shops(user_id);

COMMENT ON TABLE public.user_followed_shops IS '用户关注的店铺';
