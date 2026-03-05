import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  console.error('DB_DSN 未配置')
  process.exit(1)
}

/** 将 orders 表的 status 约束改为包含全部状态：含 delivered、in_transit、refund_pending、refunded */
const sql = `
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'pending',
    'paid',
    'shipped',
    'in_transit',
    'delivered',
    'completed',
    'return_pending',
    'returned',
    'refund_pending',
    'refunded',
    'cancelled'
  ));
`

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    console.log('orders 表 status 约束已更新（已包含 delivered 等状态）')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('更新 orders_status_check 失败', err)
  process.exit(1)
})
