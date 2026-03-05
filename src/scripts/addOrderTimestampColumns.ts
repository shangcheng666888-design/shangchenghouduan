import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  console.error('DB_DSN 未配置，无法为 orders 添加时间戳字段')
  process.exit(1)
}

/** 为已存在的 orders 表补齐状态时间戳列（与 createOrdersTables 一致） */
const statements = [
  'ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS paid_at timestamptz',
  'ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipped_at timestamptz',
  'ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS in_transit_at timestamptz',
  'ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz',
  'ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS completed_at timestamptz',
  'ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS return_requested_at timestamptz',
  'ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS returned_at timestamptz',
  'ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS refund_requested_at timestamptz',
  'ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz',
  'ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz',
]

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    for (const sql of statements) {
      await client.query(sql)
    }
    console.log('orders 表时间戳字段（含 in_transit_at, refund_requested_at, refunded_at）已确保存在')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('为 orders 添加时间戳字段失败', err)
  process.exit(1)
})
