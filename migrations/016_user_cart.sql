-- 用户购物车：持久化，与前端 CartItem 对应

CREATE TABLE IF NOT EXISTS public.user_cart (
  user_id   text NOT NULL,
  item_id   text NOT NULL,
  shop_id   text,
  product_id text,
  title     text NOT NULL,
  price     numeric(12,2) NOT NULL,
  quantity  int NOT NULL DEFAULT 1,
  image     text,
  spec      text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_cart_user_id ON public.user_cart(user_id);
COMMENT ON TABLE public.user_cart IS '用户购物车，按用户+商品项持久化';
