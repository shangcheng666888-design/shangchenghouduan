import 'dotenv/config'
import { getPool } from '../src/db.js'

/**
 * 调试用：查看指定订单的核心字段
 * 用法: npx tsx scripts/inspectOrder.ts <orderId>
 */
const orderId = process.argv[2]

if (!orderId) {
  console.error('用法: npx tsx scripts/inspectOrder.ts <orderId>')
  process.exit(1)
}

async function main() {
  const pool = getPool()
  try {
    const orderRes = await pool.query<{
      id: string
      status: string
      shop_id: string
      user_id: string
      total_amount: string
      revenue_amount: string | null
      revenue_paid_at: string | null
    }>(
      `SELECT id, status, shop_id, user_id, total_amount, revenue_amount, revenue_paid_at
       FROM orders
       WHERE id = $1`,
      [orderId],
    )
    console.log('order row:', orderRes.rows)

    if (orderRes.rows.length > 0) {
      const shopId = orderRes.rows[0].shop_id
      const shopRes = await pool.query<{
        id: string
        wallet_balance: string | null
        sales: string | null
        level: number | null
      }>(
        `SELECT id, wallet_balance, sales, level
         FROM shops
         WHERE id = $1`,
        [shopId],
      )
      console.log('shop row:', shopRes.rows)
    }
  } catch (e) {
    console.error('inspectOrder error:', e)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error('inspectOrder failed:', e)
  process.exit(1)
})

