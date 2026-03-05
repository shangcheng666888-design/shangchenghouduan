-- 订单结算/回款字段：订单完成时回款到店铺依赖这些列
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS procurement_total numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS profit_amount numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS profit_ratio numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS revenue_amount numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cost_settled_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS revenue_paid_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_shop_revenue_paid_at ON public.orders (shop_id, revenue_paid_at);
