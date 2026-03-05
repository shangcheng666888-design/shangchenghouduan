import 'dotenv/config'
import { getPool } from '../db.ts'

async function main() {
  const pool = getPool()
  const sql = `
  alter table if exists shop_applications
    add column if not exists user_id text;
  `
  await pool.query(sql)
  console.log('[addShopApplicationUserId] done')
  await pool.end()
}

main().catch((e) => {
  console.error('[addShopApplicationUserId] failed', e)
  process.exit(1)
})

