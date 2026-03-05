import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  // eslint-disable-next-line no-console
  console.error('DB_DSN 未配置，无法为 products 添加供货状态列')
  process.exit(1)
}

const sql = `
alter table if exists products
  add column if not exists supply_status text not null default 'on';

create index if not exists idx_products_supply_status
  on products (supply_status);
`

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    // eslint-disable-next-line no-console
    console.log('products.supply_status 列已确保存在')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('添加 products.supply_status 列失败', err)
  process.exit(1)
})

