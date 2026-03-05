import 'dotenv/config'
import { getPool } from '../src/db.js'

async function main() {
  const pool = getPool()

  const sql = `
DO $$
BEGIN
  -- 订单相关：order_items 依赖 orders，优先尝试成对截断
  IF to_regclass('public.orders') IS NOT NULL THEN
    IF to_regclass('public.order_items') IS NOT NULL THEN
      EXECUTE 'TRUNCATE TABLE public.order_items, public.orders RESTART IDENTITY';
    ELSE
      EXECUTE 'TRUNCATE TABLE public.orders RESTART IDENTITY CASCADE';
    END IF;
  END IF;

  -- 店铺商品与店铺钱包流水
  IF to_regclass('public.shop_products') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE public.shop_products RESTART IDENTITY';
  END IF;

  IF to_regclass('public.shop_fund_logs') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE public.shop_fund_logs RESTART IDENTITY';
  END IF;

  IF to_regclass('public.shop_fund_applications') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE public.shop_fund_applications RESTART IDENTITY';
  END IF;

  -- 用户资金、申请
  IF to_regclass('public.user_fund_logs') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE public.user_fund_logs RESTART IDENTITY';
  END IF;

  IF to_regclass('public.user_fund_applications') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE public.user_fund_applications RESTART IDENTITY';
  END IF;

  -- 用户收藏、关注、购物车
  IF to_regclass('public.user_product_favorites') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE public.user_product_favorites RESTART IDENTITY';
  END IF;

  IF to_regclass('public.user_followed_shops') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE public.user_followed_shops RESTART IDENTITY';
  END IF;

  IF to_regclass('public.user_cart') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE public.user_cart RESTART IDENTITY';
  END IF;

  -- 商家入驻与店铺主体
  IF to_regclass('public.shop_applications') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE public.shop_applications RESTART IDENTITY';
  END IF;

  IF to_regclass('public.shops') IS NOT NULL THEN
    -- 使用 CASCADE 一并清理所有依赖 shops 的表（如 shop_recommendations、首页推荐店铺等）
    EXECUTE 'TRUNCATE TABLE public.shops RESTART IDENTITY CASCADE';
  END IF;

  -- 最后清空用户表
  IF to_regclass('public.users') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE public.users RESTART IDENTITY';
  END IF;
END
$$;
`

  await pool.query(sql)
  // eslint-disable-next-line no-console
  console.log('[clearUserAndShopData] 所有用户、店铺及相关记录已清空（如上表存在）')
  await pool.end()
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[clearUserAndShopData] 执行失败', e)
  process.exit(1)
})

