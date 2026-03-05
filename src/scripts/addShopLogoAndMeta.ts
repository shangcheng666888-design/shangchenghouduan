import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  // eslint-disable-next-line no-console
  console.error('DB_DSN 未配置，无法为 shops 添加扩展字段')
  process.exit(1)
}

const sql = `
alter table if exists shops
  add column if not exists logo text,
  add column if not exists address text,
  add column if not exists country text;
`

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    // eslint-disable-next-line no-console
    console.log('shops 表 logo/address/country 字段已确保存在')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('为 shops 添加扩展字段失败', err)
  process.exit(1)
})

