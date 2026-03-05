import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  // eslint-disable-next-line no-console
  console.error('DB_DSN 未配置，无法创建 orders 表')
  process.exit(1)
}

const sql = `
CREATE TABLE IF NOT EXISTS orders (
  id             text PRIMARY KEY,
  order_number   text UNIQUE,
  user_id        text NOT NULL,
  shop_id        text NOT NULL,
  total_amount   numeric(18,2) NOT NULL,
  addr_recipient   text NOT NULL,
  addr_phone_code  text NOT NULL,
  addr_phone       text NOT NULL,
  addr_email       text,
  addr_country     text NOT NULL,
  addr_province    text NOT NULL,
  addr_city        text NOT NULL,
  addr_postal      text NOT NULL,
  addr_detail      text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','shipped','in_transit','delivered','completed','return_pending','returned','refund_pending','refunded','cancelled')),
  payment_method text NOT NULL DEFAULT 'balance',
  tracking_no    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz,
  shipped_at         timestamptz,
  in_transit_at      timestamptz,
  delivered_at       timestamptz,
  completed_at       timestamptz,
  return_requested_at timestamptz,
  returned_at        timestamptz,
  refund_requested_at timestamptz,
  refunded_at        timestamptz,
  cancelled_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_orders_user_created_at ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_shop_created_at ON orders (shop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id          bigserial PRIMARY KEY,
  order_id    text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id  text,
  product_id  text,
  title       text NOT NULL,
  image       text,
  unit_price  numeric(18,2) NOT NULL,
  quantity    integer NOT NULL CHECK (quantity > 0),
  spec        text
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_listing_id ON order_items (listing_id);
`;

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    // eslint-disable-next-line no-console
    console.log('orders / order_items 表已确保存在')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('创建 orders 表失败', err)
  process.exit(1)
})

