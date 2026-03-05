import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  // eslint-disable-next-line no-console
  console.error('DB_DSN 未配置，无法创建 shop_applications 表')
  process.exit(1)
}

const sql = `
create table if not exists shop_applications (
  id              text primary key,
  store_name      text not null,
  store_address   text not null,
  country         text not null,
  id_number       text not null,
  real_name       text not null,
  email           text not null,
  password        text not null,
  invitation_code text default '' not null,
  logo            text,
  id_front        text,
  id_back         text,
  id_handheld     text,
  signature       text,
  status          text not null default 'pending',
  created_at      timestamptz not null default now()
);

create index if not exists idx_shop_applications_status
  on shop_applications (status, created_at desc);
`

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    // eslint-disable-next-line no-console
    console.log('shop_applications 表已确保存在')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('创建 shop_applications 表失败', err)
  process.exit(1)
})

