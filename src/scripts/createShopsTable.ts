import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  // eslint-disable-next-line no-console
  console.error('DB_DSN 未配置，无法创建 shops 表')
  process.exit(1)
}

const sql = `
create table if not exists shops (
  id             text primary key,
  name           text not null,
  owner_id       text not null,
  status         text not null default 'normal',
  credit_score   integer not null default 100,
  wallet_balance numeric(18,2) not null default 0,
  level          integer not null default 1,
  followers      integer not null default 0,
  sales          integer not null default 0,
  good_rate      integer not null default 100,
  created_at     timestamptz not null default now()
);

create index if not exists idx_shops_owner_id
  on shops (owner_id);

create index if not exists idx_shops_status_created_at
  on shops (status, created_at desc);
`

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    // eslint-disable-next-line no-console
    console.log('shops 表已确保存在')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('创建 shops 表失败', err)
  process.exit(1)
})

