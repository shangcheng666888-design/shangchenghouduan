import 'dotenv/config'
import { getPool } from '../src/db.js'

/**
 * 临时调试脚本：模拟 PATCH /api/orders/:id
 * 用法：
 *   npx tsx scripts/debugOrderPatch.ts <orderId> <status>
 */
const orderId = process.argv[2]
const status = (process.argv[3] || 'completed') as string

if (!orderId) {
  console.error('用法: npx tsx scripts/debugOrderPatch.ts <orderId> <status>')
  process.exit(1)
}

async function main() {
  const pool = getPool()
  try {
    console.log('before:', (await pool.query('SELECT id, status FROM orders WHERE id = $1', [orderId])).rows)
    const sql = `
      UPDATE orders
      SET status = $1,
          delivered_at = NOW(),
          completed_at = NOW()
      WHERE id = $2
      RETURNING id, status
    `
    const res = await pool.query(sql, [status, orderId])
    console.log('after:', res.rows)
  } catch (e) {
    console.error('debugOrderPatch error:', e)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error('debugOrderPatch failed:', e)
  process.exit(1)
})

