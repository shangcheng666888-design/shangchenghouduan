import 'dotenv/config'
import { getPool } from '../db.js'

async function main() {
  const pool = getPool()
  const sql = `
  create index if not exists idx_products_category_id
    on products (category_id);

  create index if not exists idx_products_sub_category_id
    on products (sub_category_id);

  create index if not exists idx_products_product_id
    on products (product_id);
  `
  await pool.query(sql)
  console.log('[addProductsSupplyIndexes] done')
  await pool.end()
}

main().catch((e) => {
  console.error('[addProductsSupplyIndexes] failed', e)
  process.exit(1)
})

