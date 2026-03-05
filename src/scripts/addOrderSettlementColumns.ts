import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  console.error('DB_DSN 未配置，无法为 orders 添加结算字段')
  process.exit(1)
}

const sql = `
ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS procurement_total numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_ratio numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revenue_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS revenue_paid_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_shop_revenue_paid_at
  ON orders (shop_id, revenue_paid_at);
`

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    console.log('orders 表结算/回款字段已确保存在')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('为 orders 添加结算字段失败', err)
  process.exit(1)
})

