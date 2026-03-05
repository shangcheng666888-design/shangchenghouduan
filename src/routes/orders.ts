import { Router } from 'express'
import { getPool } from '../db.js'
import { getById as getUserById, updateUser, insertFundLog } from '../db/usersDb.js'

export const ordersRouter = Router()

type DbOrderStatus = 'pending' | 'paid' | 'shipped' | 'in_transit' | 'delivered' | 'completed' | 'return_pending' | 'returned' | 'refund_pending' | 'refunded' | 'cancelled'

function mapRowToApiOrder(row: {
  id: string
  order_number: string | null
  user_id: string
  shop_id: string
  total_amount: string
  status: string
  tracking_no: string | null
  created_at: string
  addr_recipient: string
  addr_phone_code: string
  addr_phone: string
  addr_email: string | null
  addr_country: string
  addr_province: string
  addr_city: string
  addr_postal: string
  addr_detail: string
  procurement_total?: string | null
  revenue_amount?: string | null
}) {
  return {
    id: row.id,
    orderNumber: row.order_number ?? row.id,
    userId: row.user_id,
    shopId: row.shop_id,
    amount: Number(row.total_amount ?? 0),
    procurementTotal: Number(row.procurement_total ?? 0),
    revenueAmount: Number(row.revenue_amount ?? 0),
    status: row.status as DbOrderStatus,
    trackingNo: row.tracking_no ?? undefined,
    createdAt: row.created_at,
    address: {
      recipient: row.addr_recipient,
      phoneCode: row.addr_phone_code,
      phone: row.addr_phone,
      email: row.addr_email ?? '',
      country: row.addr_country,
      province: row.addr_province,
      city: row.addr_city,
      postal: row.addr_postal,
      detail: row.addr_detail,
    },
  }
}

ordersRouter.get('/', async (req, res) => {
  try {
    const pool = getPool()
    const shopQuery = typeof req.query.shop === 'string' ? req.query.shop.trim() : ''
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : ''

    let shopIds: string[] = []
    if (shopQuery) {
      const idRow = await pool.query<{ id: string }>('SELECT id FROM shops WHERE id = $1', [shopQuery])
      if (idRow.rows.length > 0) {
        shopIds = [idRow.rows[0].id]
      } else {
        const nameRows = await pool.query<{ id: string }>(
          'SELECT id FROM shops WHERE name ILIKE $1',
          [`%${shopQuery}%`],
        )
        shopIds = nameRows.rows.map((r) => r.id)
      }
    }

    const whereParts: string[] = ['1=1']
    const params: unknown[] = []
    if (shopIds.length === 1) {
      params.push(shopIds[0])
      whereParts.push(`shop_id = $${params.length}`)
    } else if (shopIds.length > 1) {
      params.push(shopIds)
      whereParts.push(`shop_id = ANY($${params.length}::text[])`)
    } else if (shopQuery) {
      res.json({ list: [] })
      return
    }
    if (userId) {
      params.push(userId)
      whereParts.push(`user_id = $${params.length}`)
    }
    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''

    const orderRes = await pool.query<{
      id: string
      order_number: string | null
      user_id: string
      shop_id: string
      total_amount: string
      status: string
      tracking_no: string | null
      created_at: string
      addr_recipient: string
      addr_phone_code: string
      addr_phone: string
      addr_email: string | null
      addr_country: string
      addr_province: string
      addr_city: string
      addr_postal: string
      addr_detail: string
      procurement_total: string | null
      revenue_amount: string | null
    }>(
      `SELECT id, order_number, user_id, shop_id, total_amount, status, tracking_no, created_at,
              addr_recipient, addr_phone_code, addr_phone, addr_email, addr_country, addr_province, addr_city, addr_postal, addr_detail,
              procurement_total, revenue_amount
       FROM orders
       ${where}
       ORDER BY created_at DESC`,
      params,
    )

    const orders = orderRes.rows
    if (orders.length === 0) {
      res.json({ list: [] })
      return
    }

    const ids = orders.map((o) => o.id)
    const itemRes = await pool.query<{
      order_id: string
      listing_id: string | null
      product_id: string | null
      title: string
      image: string | null
      unit_price: string
      quantity: number
      spec: string | null
    }>(
      `SELECT order_id, listing_id, product_id, title, image, unit_price, quantity, spec
       FROM order_items
       WHERE order_id = ANY ($1::text[])`,
      [ids],
    )

    const itemsByOrder = new Map<string, typeof itemRes.rows>()
    for (const row of itemRes.rows) {
      const list = itemsByOrder.get(row.order_id) ?? []
      list.push(row)
      itemsByOrder.set(row.order_id, list)
    }

    // 统一计算每个订单的采购总价：按商品采购价（无则用销售价）× 数量
    const costRes = await pool.query<{
      order_id: string
      procurement_total: string | null
    }>(
      `SELECT oi.order_id,
              SUM(
                oi.quantity * COALESCE(
                  p.purchase_price,
                  p.selling_price,
                  0
                )
              ) AS procurement_total
       FROM order_items oi
       LEFT JOIN products p ON p.product_id = oi.product_id
       WHERE oi.order_id = ANY($1::text[])
       GROUP BY oi.order_id`,
      [ids],
    )
    const costByOrder = new Map<string, number>()
    for (const row of costRes.rows) {
      const v = Math.round(Number(row.procurement_total ?? 0) * 100) / 100
      costByOrder.set(row.order_id, v)
    }

    const list = orders.map((row) => {
      const base = mapRowToApiOrder(row)
      const computedCost = costByOrder.get(row.id)
      const withCost =
        typeof computedCost === 'number'
          ? { ...base, procurementTotal: computedCost }
          : base
      const items = (itemsByOrder.get(row.id) ?? []).map((it) => ({
        id: it.listing_id ?? it.product_id ?? String(it.order_id),
        listingId: it.listing_id ?? undefined,
        productId: it.product_id ?? undefined,
        title: it.title,
        price: Number(it.unit_price ?? 0),
        quantity: it.quantity,
        image: it.image ?? undefined,
        spec: it.spec ?? undefined,
      }))
      return { ...withCost, items }
    })

    res.json({ list })
  } catch (e) {
    console.error('[orders list]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

ordersRouter.get('/:id', async (req, res) => {
  try {
    const pool = getPool()
    const orderRes = await pool.query<{
      id: string
      order_number: string | null
      user_id: string
      shop_id: string
      total_amount: string
      status: string
      tracking_no: string | null
      created_at: string
      addr_recipient: string
      addr_phone_code: string
      addr_phone: string
      addr_email: string | null
      addr_country: string
      addr_province: string
      addr_city: string
      addr_postal: string
      addr_detail: string
      procurement_total: string | null
      revenue_amount: string | null
    }>(
      `SELECT id, order_number, user_id, shop_id, total_amount, status, tracking_no, created_at,
              addr_recipient, addr_phone_code, addr_phone, addr_email, addr_country, addr_province, addr_city, addr_postal, addr_detail,
              procurement_total, revenue_amount
       FROM orders
       WHERE id = $1`,
      [req.params.id],
    )
    if (orderRes.rows.length === 0) {
      res.status(404).json({ success: false, message: '订单不存在' })
      return
    }
    const row = orderRes.rows[0]
    let base = mapRowToApiOrder(row)

    // 详情中也统一展示计算后的采购总价
    const costRes = await pool.query<{ procurement_total: string | null }>(
      `SELECT SUM(
         oi.quantity * COALESCE(
           p.purchase_price,
           p.selling_price,
           0
         )
       ) AS procurement_total
       FROM order_items oi
       LEFT JOIN products p ON p.product_id = oi.product_id
       WHERE oi.order_id = $1`,
      [req.params.id],
    )
    const cost =
      costRes.rows.length > 0
        ? Math.round(Number(costRes.rows[0].procurement_total ?? 0) * 100) / 100
        : 0
    base = { ...base, procurementTotal: cost }

    const itemRes = await pool.query<{
      order_id: string
      listing_id: string | null
      product_id: string | null
      title: string
      image: string | null
      unit_price: string
      quantity: number
      spec: string | null
    }>(
      `SELECT order_id, listing_id, product_id, title, image, unit_price, quantity, spec
       FROM order_items
       WHERE order_id = $1`,
      [req.params.id],
    )
    const items = itemRes.rows.map((it) => ({
      id: it.listing_id ?? it.product_id ?? String(it.order_id),
      listingId: it.listing_id ?? undefined,
      productId: it.product_id ?? undefined,
      title: it.title,
      price: Number(it.unit_price ?? 0),
      quantity: it.quantity,
      image: it.image ?? undefined,
      spec: it.spec ?? undefined,
    }))
    res.json({ ...base, items })
  } catch (e) {
    console.error('[orders get]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

ordersRouter.patch('/:id', async (req, res) => {
  try {
    const pool = getPool()
    const body = req.body as { status?: DbOrderStatus; trackingNo?: string | null }

    // 订单完成：需要把预计回款打回店铺钱包（后端持久化，避免重复回款）
    if (body.status === 'completed') {
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
          [req.params.id],
        )
        if (orderRes.rows.length === 0) {
          await client.query('ROLLBACK')
          res.status(404).json({ success: false, message: '订单不存在' })
          return
        }

        const o = orderRes.rows[0]
        // 已取消或退货的订单不允许再结算为已完成
        if (o.status === 'cancelled' || o.status === 'returned') {
          await client.query('ROLLBACK')
          res.status(400).json({ success: false, message: '已取消或退货的订单无法结算为完成' })
          return
        }

        const orderAmount = Math.round(Number(o.total_amount ?? 0) * 100) / 100
        const revenueAmount = Math.round(Number(o.revenue_amount ?? o.total_amount ?? 0) * 100) / 100

        // 锁定店铺行：用于回款 + 累计销售额（等级由管理员手动调整，不自动升级）
        const shopRes = await client.query<{ wallet_balance: string | null; sales: string | null; level: number | null }>(
          'SELECT wallet_balance, sales, level FROM shops WHERE id = $1 FOR UPDATE',
          [o.shop_id],
        )
        if (shopRes.rows.length === 0) {
          await client.query('ROLLBACK')
          res.status(400).json({ success: false, message: '店铺不存在，无法回款' })
          return
        }

        const currentWallet = Number(shopRes.rows[0].wallet_balance ?? 0)
        const currentSales = Number(shopRes.rows[0].sales ?? 0)
        const currentLevel = shopRes.rows[0].level ?? 1

        // 1) 计算回款后的店铺余额（幂等：已回款则不重复入账）
        let walletAfter = currentWallet
        if (!o.revenue_paid_at && revenueAmount > 0) {
          walletAfter = Math.round((currentWallet + revenueAmount) * 100) / 100
          await client.query(
            `INSERT INTO shop_fund_logs (shop_id, type, amount, balance_after, related_id, remark, order_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [o.shop_id, 'recharge', revenueAmount, walletAfter, o.id, '订单完成回款', null],
          )
          await client.query('UPDATE orders SET revenue_paid_at = NOW() WHERE id = $1', [o.id])
        }

        // 2) 累加店铺累计销售额：仅当本次由非 completed 状态进入 completed 时才增加
        let newSales = currentSales
        if (o.status !== 'completed' && orderAmount > 0) {
          newSales = Math.round((currentSales + orderAmount) * 100) / 100
        }

        // 3) 更新店铺钱包余额 + 累计销售额（等级保持不变，由管理员手动修改）
        await client.query(
          'UPDATE shops SET wallet_balance = $1, sales = $2, level = $3 WHERE id = $4',
          [walletAfter, newSales, currentLevel, o.shop_id],
        )

        // 更新订单状态与时间戳
        await client.query(
          `UPDATE orders
           SET status = 'completed',
               completed_at = NOW(),
               tracking_no = COALESCE($2, tracking_no)
           WHERE id = $1`,
          [req.params.id, body.trackingNo && body.trackingNo.trim() ? body.trackingNo.trim() : null],
        )

        await client.query('COMMIT')
        res.json({ success: true })
        return
      } catch (e) {
        await client.query('ROLLBACK')
        console.error('[orders patch completed]', e)
        res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
        return
      } finally {
        client.release()
      }
    }

    // 状态不可逆：已支付不能改回待支付；订单完成后只能进入退款流程
    if (body.status) {
      const currentRes = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [req.params.id])
      if (currentRes.rows.length > 0) {
        const current = currentRes.rows[0].status
        if (body.status === 'pending' && current !== 'pending') {
          res.status(400).json({ success: false, message: '订单已支付后不能改回待支付状态' })
          return
        }
        if (current === 'completed' && !['return_pending', 'returned', 'refund_pending', 'refunded'].includes(body.status)) {
          res.status(400).json({ success: false, message: '订单已完成，只能进行退款流程（申请退货/已退货/正在退款/已退款），无法改回之前状态' })
          return
        }
      }
    }

    const fields: string[] = []
    const values: unknown[] = []
    let i = 1
    if (body.status && ['pending', 'paid', 'shipped', 'in_transit', 'delivered', 'completed', 'return_pending', 'returned', 'refund_pending', 'refunded', 'cancelled'].includes(body.status)) {
      fields.push(`status = $${i++}`)
      values.push(body.status)
      if (body.status === 'shipped') {
        fields.push(`shipped_at = NOW()`)
      } else if (body.status === 'in_transit') {
        fields.push(`in_transit_at = NOW()`)
      } else if (body.status === 'delivered') {
        fields.push(`delivered_at = NOW()`)
      } else if (body.status === 'return_pending') {
        fields.push(`return_requested_at = NOW()`)
      } else if (body.status === 'returned') {
        fields.push(`returned_at = NOW()`)
      } else if (body.status === 'refund_pending') {
        fields.push(`refund_requested_at = NOW()`)
      } else if (body.status === 'refunded') {
        fields.push(`refunded_at = NOW()`)
      } else if (body.status === 'cancelled') {
        fields.push(`cancelled_at = NOW()`)
      }
    }
    if (body.trackingNo !== undefined) {
      fields.push(`tracking_no = $${i++}`)
      values.push(body.trackingNo && body.trackingNo.trim() ? body.trackingNo.trim() : null)
    }
    if (fields.length === 0) {
      res.json({ success: true })
      return
    }
    values.push(req.params.id)
    const sql = `UPDATE orders SET ${fields.join(', ')} WHERE id = $${i} RETURNING id`
    const result = await pool.query(sql, values)
    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ success: false, message: '订单不存在' })
      return
    }
    res.json({ success: true })
  } catch (e) {
    console.error('[orders patch]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 发货结算预览：返回订单金额、采购总价、店铺余额，供前端展示结算弹窗 */
ordersRouter.get('/:id/ship-preview', async (req, res) => {
  try {
    const pool = getPool()
    const orderRes = await pool.query<{ total_amount: string; shop_id: string; status: string }>(
      'SELECT total_amount, shop_id, status FROM orders WHERE id = $1',
      [req.params.id],
    )
    if (orderRes.rows.length === 0) {
      res.status(404).json({ success: false, message: '订单不存在' })
      return
    }
    const order = orderRes.rows[0]
    if (order.status !== 'paid') {
      res.status(400).json({ success: false, message: '当前订单状态不支持发货结算' })
      return
    }
    const orderAmount = Math.round(Number(order.total_amount ?? 0) * 100) / 100

    const itemRes = await pool.query<{
      quantity: number
      purchase_price: string | null
      selling_price: string | null
    }>(
      `SELECT oi.quantity, p.purchase_price, p.selling_price
       FROM order_items oi
       LEFT JOIN products p ON p.product_id = oi.product_id
       WHERE oi.order_id = $1`,
      [req.params.id],
    )
    let procurementTotal = 0
    for (const row of itemRes.rows) {
      const base =
        row.purchase_price != null
          ? Number(row.purchase_price)
          : row.selling_price != null
            ? Number(row.selling_price)
            : 0
      if (Number.isFinite(base) && base > 0 && row.quantity > 0) {
        procurementTotal += base * row.quantity
      }
    }
    procurementTotal = Math.round(procurementTotal * 100) / 100

    const shopRes = await pool.query<{ wallet_balance: string | null }>(
      'SELECT wallet_balance FROM shops WHERE id = $1',
      [order.shop_id],
    )
    const walletBalance = shopRes.rows.length > 0 ? Number(shopRes.rows[0].wallet_balance ?? 0) : 0

    const profitAmount = Math.round((orderAmount - procurementTotal) * 100) / 100
    const profitRatio = procurementTotal > 0 ? Math.round((profitAmount / procurementTotal) * 100000) / 1000 : 0
    const expectedRevenue = orderAmount

    res.json({
      orderAmount,
      procurementTotal,
      profitAmount,
      profitRatio,
      expectedRevenue,
      walletBalance: Number.isFinite(walletBalance) ? Math.round(walletBalance * 100) / 100 : 0,
    })
  } catch (e) {
    console.error('[orders ship-preview]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 商家发货并结算采购成本：从店铺钱包扣除采购总价，订单状态改为 shipped */
ordersRouter.post('/:id/merchant-ship', async (req, res) => {
  const pool = getPool()
  const { trackingNo } = req.body as { trackingNo?: string | null }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 锁定订单行，确保状态与店铺信息一致
    const orderRes = await client.query<{
      id: string
      shop_id: string
      status: DbOrderStatus
    }>('SELECT id, shop_id, status FROM orders WHERE id = $1 FOR UPDATE', [req.params.id])

    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ success: false, message: '订单不存在' })
      return
    }

    const order = orderRes.rows[0]
    if (order.status !== 'paid') {
      await client.query('ROLLBACK')
      res.status(400).json({ success: false, message: '当前订单状态不支持发货结算' })
      return
    }

    // 计算采购总价：按商品仓采购价（无则用销售价）× 数量
    const itemRes = await client.query<{
      quantity: number
      purchase_price: string | null
      selling_price: string | null
    }>(
      `SELECT oi.quantity,
              p.purchase_price,
              p.selling_price
       FROM order_items oi
       LEFT JOIN products p ON p.product_id = oi.product_id
       WHERE oi.order_id = $1`,
      [order.id],
    )

    let totalCost = 0
    for (const row of itemRes.rows) {
      const base =
        row.purchase_price != null
          ? Number(row.purchase_price)
          : row.selling_price != null
          ? Number(row.selling_price)
          : 0
      if (Number.isFinite(base) && base > 0 && row.quantity > 0) {
        totalCost += base * row.quantity
      }
    }
    // 保留 2 位小数
    totalCost = Math.round(totalCost * 100) / 100

    // 写入订单结算字段（持久化）
    const amountRes = await client.query<{ total_amount: string }>('SELECT total_amount FROM orders WHERE id = $1', [order.id])
    const orderAmount = Math.round(Number(amountRes.rows[0]?.total_amount ?? 0) * 100) / 100
    const profitAmount = Math.round((orderAmount - totalCost) * 100) / 100
    const profitRatio = totalCost > 0 ? Math.round((profitAmount / totalCost) * 100000) / 1000 : 0

    // 若采购成本为 0，则不做资金扣减，仅更新为已发货 + 结算字段
    if (totalCost <= 0) {
      await client.query(
        `UPDATE orders
         SET status = 'shipped',
             shipped_at = NOW(),
             tracking_no = $1,
             procurement_total = $2,
             profit_amount = $3,
             profit_ratio = $4,
             revenue_amount = $5,
             cost_settled_at = NOW()
         WHERE id = $6`,
        [
          trackingNo && trackingNo.trim() ? trackingNo.trim() : null,
          0,
          profitAmount,
          profitRatio,
          orderAmount,
          order.id,
        ],
      )
      await client.query('COMMIT')
      res.json({ success: true, status: 'shipped', settleAmount: 0, walletBalance: null })
      return
    }

    // 锁定店铺钱包余额
    const shopRes = await client.query<{ wallet_balance: string | null }>(
      'SELECT wallet_balance FROM shops WHERE id = $1 FOR UPDATE',
      [order.shop_id],
    )
    if (shopRes.rows.length === 0) {
      await client.query('ROLLBACK')
      res.status(400).json({ success: false, message: '店铺不存在，无法结算' })
      return
    }

    const wallet = Number(shopRes.rows[0].wallet_balance ?? 0)
    if (!Number.isFinite(wallet) || wallet < totalCost) {
      await client.query('ROLLBACK')
      res.status(400).json({
        success: false,
        message: '店铺余额不足，请先在店铺资金管理中充值后再发货',
        required: totalCost,
        walletBalance: wallet,
      })
      return
    }

    const after = Math.round((wallet - totalCost) * 100) / 100

    await client.query('UPDATE shops SET wallet_balance = $1 WHERE id = $2', [after, order.shop_id])

    // 记录店铺资金流水：采购结算（消费）
    await client.query(
      `INSERT INTO shop_fund_logs (shop_id, type, amount, balance_after, related_id, remark, order_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [order.shop_id, 'consume', -totalCost, after, order.id, '订单发货采购结算', null],
    )

    // 更新订单状态为已发货
    await client.query(
      `UPDATE orders
       SET status = 'shipped',
           shipped_at = NOW(),
           tracking_no = $1,
           procurement_total = $3,
           profit_amount = $4,
           profit_ratio = $5,
           revenue_amount = $6,
           cost_settled_at = NOW()
       WHERE id = $2`,
      [
        trackingNo && trackingNo.trim() ? trackingNo.trim() : null,
        order.id,
        totalCost,
        profitAmount,
        profitRatio,
        orderAmount,
      ],
    )

    await client.query('COMMIT')

    res.json({ success: true, status: 'shipped', settleAmount: totalCost, walletBalance: after })
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('[orders merchant-ship]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  } finally {
    client.release()
  }
})

ordersRouter.post('/', async (req, res) => {
  try {
    const body = req.body as {
      shopId?: string
      userId?: string
      amount?: number
      orderNumber?: string
      items?: Array<{ id: string; productId?: string; title: string; price: number; quantity: number; image?: string; spec?: string }>
      address?: {
        recipient?: string
        email?: string
        phoneCode?: string
        phone?: string
        country?: string
        province?: string
        city?: string
        postal?: string
        detail?: string
      }
    }
    if (!body.shopId || !body.userId || body.amount == null) {
      res.status(400).json({ success: false, message: '缺少 shopId / userId / amount' })
      return
    }
    const user = await getUserById(body.userId)
    if (!user) {
      res.status(400).json({ success: false, message: '用户不存在' })
      return
    }
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ success: false, message: '金额不合法' })
      return
    }
    if (user.balance < amount) {
      res.status(400).json({ success: false, message: '余额不足' })
      return
    }
    const id = 'O' + Date.now()
    const addr = body.address ?? {}
    const address = {
      recipient: addr.recipient ?? '',
      email: addr.email ?? '',
      phoneCode: addr.phoneCode ?? '',
      phone: addr.phone ?? '',
      country: addr.country ?? '',
      province: addr.province ?? '',
      city: addr.city ?? '',
      postal: addr.postal ?? '',
      detail: addr.detail ?? '',
    }

    const balanceAfter = user.balance - amount
    await updateUser(body.userId, { balance: balanceAfter })
    const orderCode = await insertFundLog({
      userId: body.userId,
      type: 'consume',
      amount: -amount,
      balanceAfter,
      relatedId: body.orderNumber ?? undefined,
      remark: '订单支付',
    })
    const finalOrderNumber = body.orderNumber ?? orderCode

    const pool = getPool()
    const createdAt = new Date().toISOString()
    await pool.query(
      `INSERT INTO orders (
        id, order_number, user_id, shop_id, total_amount,
        addr_recipient, addr_phone_code, addr_phone, addr_email, addr_country, addr_province, addr_city, addr_postal, addr_detail,
        status, payment_method, created_at, paid_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, $12, $13, $14,
        'paid', 'balance', $15, $15
      )`,
      [
        id,
        finalOrderNumber,
        body.userId,
        body.shopId,
        amount,
        address.recipient,
        address.phoneCode,
        address.phone,
        address.email,
        address.country,
        address.province,
        address.city,
        address.postal,
        address.detail,
        createdAt,
      ],
    )

    if (Array.isArray(body.items) && body.items.length > 0) {
      const values: unknown[] = []
      const rows: string[] = []
      let i = 1
      for (const item of body.items) {
        rows.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`)
        values.push(
          id,
          item.id ?? null,
          item.productId ?? null,
          item.title,
          item.image ?? null,
          item.price,
          item.quantity,
          (item.spec && String(item.spec).trim()) ? String(item.spec).trim() : null,
        )
      }
      await pool.query(
        `INSERT INTO order_items (order_id, listing_id, product_id, title, image, unit_price, quantity, spec)
         VALUES ${rows.join(', ')}`,
        values,
      )
    }

    // 新结算链路：用户支付后不立即回款到店铺余额；待管理员将订单改为「订单完成」时再回款入账

    const apiOrder = {
      id,
      orderNumber: finalOrderNumber,
      shopId: body.shopId,
      userId: body.userId,
      amount,
      status: 'paid' as DbOrderStatus,
      trackingNo: undefined,
      createdAt,
      address,
      items: (body.items ?? []).map((it) => ({
        id: it.id,
        productId: it.productId,
        title: it.title,
        price: it.price,
        quantity: it.quantity,
        image: it.image,
        spec: it.spec,
      })),
    }

    res.status(201).json(apiOrder)
  } catch (e) {
    console.error('[orders post]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})
