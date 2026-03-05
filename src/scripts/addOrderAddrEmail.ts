import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  console.error('DB_DSN 未配置，无法为 orders 添加 addr_email 字段')
  process.exit(1)
}

const sql = `
ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS addr_email text;
`

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    console.log('orders 表 addr_email 字段已确保存在')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('为 orders 添加 addr_email 失败', err)
  process.exit(1)
})

