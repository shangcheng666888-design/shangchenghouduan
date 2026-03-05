import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  // eslint-disable-next-line no-console
  console.error('DB_DSN 未配置，无法为 users 添加 status 列')
  process.exit(1)
}

const sql = `
alter table if exists users
  add column if not exists status text not null default 'normal';

create index if not exists idx_users_status_created_at
  on users (status, created_at desc);
`

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    // eslint-disable-next-line no-console
    console.log('users 表 status 列已确保存在')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('为 users 添加 status 列失败', err)
  process.exit(1)
})

