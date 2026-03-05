import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  console.error('DB_DSN 未配置，无法为 shops 添加 level 字段')
  process.exit(1)
}

const sql = `
ALTER TABLE IF EXISTS shops
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1;
`

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    console.log('shops 表 level 字段已确保存在，默认值为 1（普通店铺）')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('为 shops 添加 level 失败', err)
  process.exit(1)
})

