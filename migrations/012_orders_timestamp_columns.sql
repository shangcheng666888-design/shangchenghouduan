-- 订单状态时间戳：PATCH 修改状态时会写入对应时间
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipped_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS in_transit_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS return_requested_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS returned_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_requested_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
