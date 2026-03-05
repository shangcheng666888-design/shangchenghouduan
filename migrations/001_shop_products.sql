-- 店铺上架商品表：卖家从供货采购并上架到自己的店铺后，商城前端才展示该商品
-- 每个商品在 products 表中已有 category_id / sub_category_id 表示所属分类

CREATE TABLE IF NOT EXISTS public.shop_products (
  shop_id    text NOT NULL,
  product_id text NOT NULL,
  status     text NOT NULL DEFAULT 'on',   -- 'on' 上架展示, 'off' 下架
  listed_at  timestamptz DEFAULT now(),
  PRIMARY KEY (shop_id, product_id)
  -- 若 products 表有 product_id 主键可取消下行注释以加外键:
  -- , CONSTRAINT fk_product FOREIGN KEY (product_id) REFERENCES public.products(product_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shop_products_shop_id ON public.shop_products(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_products_product_id ON public.shop_products(product_id);
CREATE INDEX IF NOT EXISTS idx_shop_products_status ON public.shop_products(status);

COMMENT ON TABLE public.shop_products IS '店铺已上架商品：仅在此表且 status=on 的商品会在商城站展示';
