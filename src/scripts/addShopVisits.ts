import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  // eslint-disable-next-line no-console
  console.error('DB_DSN 未配置，无法为 shops 添加 visits 字段')
  process.exit(1)
}

const sql = `
ALTER TABLE IF EXISTS shops
  ADD COLUMN IF NOT EXISTS visits integer NOT NULL DEFAULT 0;
`

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    // eslint-disable-next-line no-console
    console.log('shops 表 visits 字段已确保存在')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('为 shops 添加 visits 字段失败', err)
  process.exit(1)
})

