import { Router } from 'express'
import { getPool } from '../db.js'

export const adminDashboardRouter = Router()

/** 管理员仪表盘：从数据库汇总用户、店铺、商品、订单、近7日趋势、今日概况、系统状态 */
adminDashboardRouter.get('/', async (_req, res) => {
  try {
    const pool = getPool()

    const [
      userCountRes,
      shopCountRes,
      productCountRes,
      orderCountRes,
      todayOrdersRes,
      robotCountRes,
      orderTrendRes,
      newUsersTodayRes,
      newShopsTodayRes,
      pendingAuditRes,
    ] = await Promise.all([
      pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users'),
      pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM shops'),
      pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM shop_products WHERE status = 'on'"),
      pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM orders'),
      pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM orders WHERE created_at >= current_date AT TIME ZONE 'UTC'"
      ),
      pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users WHERE is_bot = true'),
      pool.query<{ d: string; orders: string; sales: string }>(
        `SELECT
          date(created_at AT TIME ZONE 'UTC') AS d,
          COUNT(*)::text AS orders,
          COALESCE(SUM(total_amount::numeric), 0)::text AS sales
         FROM orders
         WHERE created_at >= (current_date AT TIME ZONE 'UTC') - INTERVAL '7 days'
         GROUP BY date(created_at AT TIME ZONE 'UTC')
         ORDER BY d ASC`
      ),
      pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM users WHERE (created_at AT TIME ZONE 'UTC')::date = current_date"
      ),
      pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM shops WHERE (created_at AT TIME ZONE 'UTC')::date = current_date"
      ),
      pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM shop_applications WHERE status = 'pending'"
      ),
    ])

    const userCount = parseInt(userCountRes.rows[0]?.count ?? '0', 10)
    const shopCount = parseInt(shopCountRes.rows[0]?.count ?? '0', 10)
    const productCount = parseInt(productCountRes.rows[0]?.count ?? '0', 10)
    const orderCount = parseInt(orderCountRes.rows[0]?.count ?? '0', 10)
    const todayOrders = parseInt(todayOrdersRes.rows[0]?.count ?? '0', 10)
    const robotCount = parseInt(robotCountRes.rows[0]?.count ?? '0', 10)
    const newUsersToday = parseInt(newUsersTodayRes.rows[0]?.count ?? '0', 10)
    const newShopsToday = parseInt(newShopsTodayRes.rows[0]?.count ?? '0', 10)
    const pendingAuditShops = parseInt(pendingAuditRes.rows[0]?.count ?? '0', 10)

    const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    const last7Days: { d: string; orders: number; sales: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      const dayOfWeek = d.getUTCDay()
      const name = dayNames[dayOfWeek === 0 ? 6 : dayOfWeek - 1]
      const row = orderTrendRes.rows.find((r) => r.d && String(r.d).slice(0, 10) === dateStr)
      last7Days.push({
        d: dateStr,
        orders: row ? parseInt(row.orders ?? '0', 10) : 0,
        sales: row ? parseFloat(row.sales ?? '0') : 0,
      })
    }
    const orderTrend = last7Days.map(({ d, orders, sales }) => ({
      name: dayNames[new Date(d + 'Z').getUTCDay() === 0 ? 6 : new Date(d + 'Z').getUTCDay() - 1],
      订单: orders,
      销售额: sales,
    }))

    const visitTrend = last7Days.map(({ d }) => {
      const dayIndex = new Date(d + 'Z').getUTCDay()
      const name = dayNames[dayIndex === 0 ? 6 : dayIndex - 1]
      return { name, 访客: 0 }
    })

    res.json({
      stats: {
        userCount,
        shopCount,
        productCount,
        orderCount,
        todayOrders,
        robotCount,
      },
      orderTrend,
      visitTrend,
      todayOverview: {
        newUsersToday,
        newShopsToday,
        pendingAuditShops,
        pendingTickets: 0,
      },
      systemStatus: {
        api: 'ok',
        database: 'ok',
        robots: robotCount,
      },
    })
  } catch (e) {
    console.error('[admin dashboard]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})
