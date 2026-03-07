-- 店铺等级变更时，自动按新等级利润率重算该店铺所有已上架商品售价（无需店主下架再上架）
-- 无论等级是通过管理后台、直接改库还是后续自动升级逻辑修改，都会触发重算

CREATE OR REPLACE FUNCTION public.reprice_shop_products_on_level_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  margin_rate numeric;
BEGIN
  IF NEW.level IS NOT DISTINCT FROM OLD.level THEN
    RETURN NEW;
  END IF;

  margin_rate := CASE NEW.level
    WHEN 1 THEN 0.10
    WHEN 2 THEN 0.15
    WHEN 3 THEN 0.20
    WHEN 4 THEN 0.25
    ELSE 0.10
  END;

  UPDATE shop_products sp
  SET price = ROUND(
        (COALESCE(p.purchase_price::numeric, p.selling_price::numeric, 0) * (1 + margin_rate))::numeric,
        2
      )
  FROM products p
  WHERE p.product_id = sp.product_id
    AND sp.shop_id = NEW.id
    AND sp.status = 'on'
    AND COALESCE(p.purchase_price::numeric, p.selling_price::numeric, 0) > 0;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shops_level_reprice ON shops;
CREATE TRIGGER trg_shops_level_reprice
  AFTER UPDATE OF level ON shops
  FOR EACH ROW
  EXECUTE FUNCTION public.reprice_shop_products_on_level_change();

COMMENT ON FUNCTION public.reprice_shop_products_on_level_change() IS '店铺 level 字段更新时，按等级利润率(1=10%,2=15%,3=20%,4=25%)重算该店所有已上架商品售价';
