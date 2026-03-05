import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  // eslint-disable-next-line no-console
  console.error('DB_DSN 未配置，无法为 user_fund_logs 添加 order_code 列')
  process.exit(1)
}

const sql = `
alter table if exists user_fund_logs
  add column if not exists order_code text;

create unique index if not exists idx_user_fund_logs_order_code
  on user_fund_logs (order_code);
`

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    // eslint-disable-next-line no-console
    console.log('user_fund_logs 表 order_code 列已确保存在')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('为 user_fund_logs 添加 order_code 列失败', err)
  process.exit(1)
})

