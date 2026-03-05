import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  // eslint-disable-next-line no-console
  console.error('DB_DSN 未配置，无法为 user_fund_applications 添加字段')
  process.exit(1)
}

const sql = `
alter table if exists user_fund_applications
  add column if not exists recharge_tx_no text,
  add column if not exists withdraw_address text;
`

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    // eslint-disable-next-line no-console
    console.log('user_fund_applications 表字段已确保存在')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('为 user_fund_applications 添加字段失败', err)
  process.exit(1)
})

