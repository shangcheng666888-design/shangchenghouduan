import 'dotenv/config'
import { getPool } from '../src/db.js'

/**
 * 调试脚本：模拟 PATCH /api/orders/:id status = 'completed'
 * 用法:
 *   npx tsx scripts/debugOrderComplete.ts <orderId>
 */

const orderId = process.argv[2]

if (!orderId) {
  console.error('用法: npx tsx scripts/debugOrderComplete.ts <orderId>')
  process.exit(1)
}

async function main() {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const orderRes = await client.query<{
      id: string
      shop_id: string
      total_amount: string
      revenue_amount: string | null
      revenue_paid_at: string | null
      status: string
    }>(
      `SELECT id, shop_id, total_amount, revenue_amount, revenue_paid_at, status
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId],
    )
    console.log('order row:', orderRes.rows)

    if (orderRes.rows.length === 0) {
      throw new Error('订单不存在')
    }

    const o = orderRes.rows[0]
    const orderAmount = Math.round(Number(o.total_amount ?? 0) * 100) / 100
    const revenueAmount = Math.round(Number(o.revenue_amount ?? o.total_amount ?? 0) * 100) / 100
    console.log('amounts:', { orderAmount, revenueAmount })

    const shopRes = await client.query<{ wallet_balance: string | null; sales: string | null; level: number | null }>(
      'SELECT wallet_balance, sales, level FROM shops WHERE id = $1 FOR UPDATE',
      [o.shop_id],
    )
    console.log('shop row:', shopRes.rows)

    if (shopRes.rows.length === 0) {
      throw new Error('店铺不存在')
    }

    const currentWallet = Number(shopRes.rows[0].wallet_balance ?? 0)
    const currentSales = Number(shopRes.rows[0].sales ?? 0)
    const currentLevel = shopRes.rows[0].level ?? 1

    let walletAfter = currentWallet
    if (!o.revenue_paid_at && revenueAmount > 0) {
      walletAfter = Math.round((currentWallet + revenueAmount) * 100) / 100
      console.log('will insert shop_fund_logs, walletAfter =', walletAfter)
      await client.query(
        `INSERT INTO shop_fund_logs (shop_id, type, amount, balance_after, related_id, remark, order_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [o.shop_id, 'recharge', revenueAmount, walletAfter, o.id, '订单完成回款(调试)', null],
      )
      await client.query('UPDATE orders SET revenue_paid_at = NOW() WHERE id = $1', [o.id])
    }

    let newSales = currentSales
    if (o.status !== 'completed' && orderAmount > 0) {
      newSales = Math.round((currentSales + orderAmount) * 100) / 100
    }

    console.log('updating shop wallet/sales:', { walletAfter, newSales, currentLevel })
    await client.query(
      'UPDATE shops SET wallet_balance = $1, sales = $2, level = $3 WHERE id = $4',
      [walletAfter, newSales, currentLevel, o.shop_id],
    )

    console.log('updating order status to completed')
    await client.query(
      `UPDATE orders
       SET status = 'completed',
           completed_at = NOW()
       WHERE id = $1`,
      [orderId],
    )

    await client.query('COMMIT')
    console.log('debugOrderComplete OK')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('debugOrderComplete error:', e)
  } finally {
    client.release()
  }
}

main().catch((e) => {
  console.error('debugOrderComplete failed:', e)
  process.exit(1)
})

