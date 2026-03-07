import { Router } from 'express'
import { getPool } from '../db.js'
import { getShopById } from '../db/shopsDb.js'
import { getById as getUserById } from '../db/usersDb.js'
import {
  assertShopOwnerByUserId,
  createShopFundApplication,
  listShopFundApplicationsByShop,
} from '../db/shopFundApplicationsDb.js'
import { deleteStorageObjectIfOurs } from './upload.js'

export const shopsRouter = Router()

shopsRouter.get('/', async (req, res) => {
  try {
    const shopId = req.query.shop as string | undefined
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
    const pool = getPool()
    const params: unknown[] = []
    let where = 'WHERE 1=1'
    if (shopId) {
      params.push(shopId)
      where += ` AND s.id = $${params.length}`
    }
    if (search.length > 0) {
      params.push(`%${search}%`)
      where += ` AND (s.id ILIKE $${params.length} OR s.name ILIKE $${params.length}) AND s.status = 'normal'`
    }
    const sql = `
      SELECT
        s.id,
        s.name,
        s.owner_id,
        u.account AS owner_account,
        s.logo,
        s.banner,
        s.address,
        s.country,
        s.level,
        COALESCE(s.followers, 0)      AS follow_count,
        COALESCE(s.sales, 0)          AS sales,
        COALESCE(s.good_rate, 0)      AS good_rate,
        COALESCE(s.credit_score, 0)   AS credit_score,
        COALESCE(s.wallet_balance, 0) AS wallet_balance,
        COALESCE(s.visits, 0)         AS visits,
        s.status,
        s.created_at,
        COALESCE(sp.listed_count, 0)  AS listed_count
      FROM shops s
      LEFT JOIN users u ON u.id = s.owner_id
      LEFT JOIN (
        SELECT shop_id, COUNT(*) AS listed_count
        FROM shop_products
        WHERE status = 'on'
        GROUP BY shop_id
      ) sp ON sp.shop_id = s.id
      ${where}
      ORDER BY s.created_at DESC
    `
    const result = await pool.query<{
      id: string
      name: string
      owner_id: string
      owner_account: string | null
      level: number
      logo: string | null
      banner: string | null
      address: string | null
      country: string | null
      follow_count: number
      sales: number
      good_rate: number
      credit_score: number
      wallet_balance: number
      visits: number
      status: string
      created_at: string
      listed_count: number
    }>(sql, params)

    const levelLabel = (lvl: number | null | undefined): string => {
      if (lvl == null) return '普通'
      if (lvl >= 4) return '钻石'
      if (lvl >= 3) return '金牌'
      if (lvl >= 2) return '银牌'
      return '普通'
    }

    const list = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      ownerAccount: row.owner_account ?? '',
      logo: row.logo ?? null,
      banner: row.banner ?? null,
      address: row.address ?? null,
      country: row.country ?? null,
      level: levelLabel(row.level),
      listedCount: Number(row.listed_count ?? 0),
      followCount: Number(row.follow_count ?? 0),
      sales: Number(row.sales ?? 0),
      goodRate: Number(row.good_rate ?? 0),
      creditScore: Number(row.credit_score ?? 0),
      walletBalance: Number(row.wallet_balance ?? 0),
      visits: Number(row.visits ?? 0),
      status: (row.status as 'normal' | 'banned') ?? 'normal',
      createdAt: row.created_at,
    }))

    res.json({ list })
  } catch (e) {
    console.error('[shops list]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

shopsRouter.get('/:id', async (req, res) => {
  try {
    const shop = await getShopById(req.params.id)
    if (!shop) {
      res.status(404).json({ success: false, message: '店铺不存在' })
      return
    }
    const pool = getPool()
    const countRes = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM shop_products WHERE shop_id = $1 AND status = $2',
      [req.params.id, 'on']
    )
    const productCount = parseInt(countRes.rows[0]?.count ?? '0', 10)
    res.json({ ...shop, productCount })
  } catch (e) {
    console.error('[shops get]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

/** 记录店铺访问量：每次调用则 visits +1 */
shopsRouter.post('/:id/visit', async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query('UPDATE shops SET visits = COALESCE(visits, 0) + 1 WHERE id = $1', [req.params.id])
    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ success: false, message: '店铺不存在' })
      return
    }
    res.json({ success: true })
  } catch (e) {
    console.error('[shops visit]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

/** 店铺推荐商品：有则按推荐表返回，空则随机 2 个在售商品 */
shopsRouter.get('/:id/recommendations', async (req, res) => {
  try {
    const shopId = req.params.id
    const pool = getPool()
    let recRes: { rows: Array<{ listing_id: string; sort_order: number }> } = { rows: [] }
    try {
      recRes = await pool.query<{ listing_id: string; sort_order: number }>(
        `SELECT listing_id, sort_order FROM shop_recommendations WHERE shop_id = $1 ORDER BY sort_order ASC, created_at ASC`,
        [shopId]
      )
    } catch (tblErr: unknown) {
      const code = (tblErr as { code?: string })?.code
      if (code === '42P01') {
        console.warn('[shops recommendations] shop_recommendations 表不存在，请执行迁移: node scripts/run-migration.js 010')
      } else {
        throw tblErr
      }
    }
    if (recRes.rows.length > 0) {
      const listingIds = recRes.rows.map((r) => r.listing_id)
      const prodRes = await pool.query(
        `SELECT sp.id AS listing_id, sp.product_id, sp.price AS listing_price,
                p.product_name, p.main_images, p.selling_price AS product_price, sr.sort_order
         FROM shop_recommendations sr
         JOIN shop_products sp ON sp.shop_id = sr.shop_id AND sp.id::text = sr.listing_id AND sp.status = 'on'
         JOIN products p ON p.product_id = sp.product_id
         WHERE sr.shop_id = $1
         ORDER BY sr.sort_order ASC, sr.created_at ASC`,
        [shopId]
      )
      const list = prodRes.rows.map((r: Record<string, unknown>) => {
        const mainImages = r.main_images ?? []
        const img = Array.isArray(mainImages) && mainImages[0] ? String(mainImages[0]) : ''
        const price = r.listing_price != null ? Number(r.listing_price) : Number(r.product_price ?? 0)
        return {
          listingId: String(r.listing_id),
          productId: String(r.product_id),
          title: String(r.product_name ?? ''),
          image: img,
          price,
        }
      })
      res.json({ list })
      return
    }
    const randRes = await pool.query(
      `SELECT sp.id AS listing_id, sp.product_id, sp.price AS listing_price,
              p.product_name, p.main_images, p.selling_price AS product_price
       FROM shop_products sp
       JOIN products p ON p.product_id = sp.product_id
       WHERE sp.shop_id = $1 AND sp.status = 'on'
       ORDER BY random() LIMIT 2`,
      [shopId]
    )
    const list = randRes.rows.map((r: Record<string, unknown>) => {
      const mainImages = r.main_images ?? []
      const img = Array.isArray(mainImages) && mainImages[0] ? String(mainImages[0]) : ''
      const price = r.listing_price != null ? Number(r.listing_price) : Number(r.product_price ?? 0)
      return {
        listingId: String(r.listing_id),
        productId: String(r.product_id),
        title: String(r.product_name ?? ''),
        image: img,
        price,
      }
    })
    res.json({ list })
  } catch (e) {
    console.error('[shops recommendations]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

// 店铺交易密码：查询是否已设置（仅店铺所有者可查）
shopsRouter.get('/:id/trade-password/status', async (req, res) => {
  try {
    const shopId = req.params.id
    const userId = typeof req.query.userId === 'string' ? String(req.query.userId).trim() : ''
    if (!userId) {
      res.status(400).json({ success: false, message: '缺少用户信息' })
      return
    }
    const auth = await assertShopOwnerByUserId(shopId, userId)
    if (!auth.ok) {
      res.status(403).json({ success: false, message: auth.message ?? '无权限' })
      return
    }
    const pool = getPool()
    const r = await pool.query<{ trade_password: string | null }>(
      'SELECT trade_password FROM shops WHERE id = $1',
      [shopId],
    )
    const pwd = r.rows[0]?.trade_password ?? ''
    res.json({ hasTradePassword: !!(pwd && pwd.length > 0) })
  } catch (e) {
    console.error('[shops trade-password status]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

// 店铺交易密码：首次设置
shopsRouter.post('/:id/trade-password/set', async (req, res) => {
  try {
    const shopId = req.params.id
    const body = req.body as { userId?: string; newTradePassword?: string }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    const newPwd = typeof body.newTradePassword === 'string' ? body.newTradePassword.trim() : ''
    if (!userId) {
      res.status(400).json({ success: false, message: '缺少用户信息' })
      return
    }
    const auth = await assertShopOwnerByUserId(shopId, userId)
    if (!auth.ok) {
      res.status(403).json({ success: false, message: auth.message ?? '无权限' })
      return
    }
    const pinRegex = /^\d{6}$/
    if (!pinRegex.test(newPwd)) {
      res.status(400).json({ success: false, message: '交易密码需为 6 位数字' })
      return
    }
    const pool = getPool()
    const r = await pool.query<{ trade_password: string | null }>(
      'SELECT trade_password FROM shops WHERE id = $1',
      [shopId],
    )
    const existing = r.rows[0]?.trade_password ?? ''
    if (existing && existing.length > 0) {
      res.status(400).json({ success: false, message: '已设置过交易密码，请使用修改功能' })
      return
    }
    await pool.query('UPDATE shops SET trade_password = $1 WHERE id = $2', [newPwd, shopId])
    res.json({ success: true })
  } catch (e) {
    console.error('[shops trade-password set]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

// 店铺交易密码：修改
shopsRouter.post('/:id/trade-password/change', async (req, res) => {
  try {
    const shopId = req.params.id
    const body = req.body as { userId?: string; oldTradePassword?: string; newTradePassword?: string }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    const oldPwd = typeof body.oldTradePassword === 'string' ? body.oldTradePassword.trim() : ''
    const newPwd = typeof body.newTradePassword === 'string' ? body.newTradePassword.trim() : ''
    if (!userId) {
      res.status(400).json({ success: false, message: '缺少用户信息' })
      return
    }
    const auth = await assertShopOwnerByUserId(shopId, userId)
    if (!auth.ok) {
      res.status(403).json({ success: false, message: auth.message ?? '无权限' })
      return
    }
    const pinRegex = /^\d{6}$/
    if (!pinRegex.test(newPwd)) {
      res.status(400).json({ success: false, message: '交易密码需为 6 位数字' })
      return
    }
    const pool = getPool()
    const r = await pool.query<{ trade_password: string | null }>(
      'SELECT trade_password FROM shops WHERE id = $1',
      [shopId],
    )
    const existing = r.rows[0]?.trade_password ?? ''
    if (!existing) {
      res.status(400).json({ success: false, message: '尚未设置交易密码，请先设置' })
      return
    }
    if (!oldPwd || oldPwd !== existing) {
      res.status(400).json({ success: false, message: '旧交易密码错误' })
      return
    }
    await pool.query('UPDATE shops SET trade_password = $1 WHERE id = $2', [newPwd, shopId])
    res.json({ success: true })
  } catch (e) {
    console.error('[shops trade-password change]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

/** 添加推荐：商家在「我的商品」中点击点赞 */
shopsRouter.post('/:id/recommendations', async (req, res) => {
  try {
    const shopId = req.params.id
    const body = req.body as { userId?: string; listingId?: string }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    const listingId = typeof body.listingId === 'string' ? body.listingId.trim() : ''
    if (!userId) {
      res.status(400).json({ success: false, message: '缺少用户信息' })
      return
    }
    if (!listingId) {
      res.status(400).json({ success: false, message: '缺少 listingId' })
      return
    }
    const auth = await assertShopOwnerByUserId(shopId, userId)
    if (!auth.ok) {
      res.status(403).json({ success: false, message: auth.message ?? '无权限' })
      return
    }
    const pool = getPool()
    await pool.query(
      `INSERT INTO shop_recommendations (shop_id, listing_id) VALUES ($1, $2)
       ON CONFLICT (shop_id, listing_id) DO NOTHING`,
      [shopId, listingId]
    )
    res.status(201).json({ success: true })
  } catch (e) {
    console.error('[shops POST recommendations]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

/** 取消推荐 */
shopsRouter.delete('/:id/recommendations/:listingId', async (req, res) => {
  try {
    const shopId = req.params.id
    const listingId = req.params.listingId
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : ''
    if (!userId) {
      res.status(400).json({ success: false, message: '缺少用户信息' })
      return
    }
    const auth = await assertShopOwnerByUserId(shopId, userId)
    if (!auth.ok) {
      res.status(403).json({ success: false, message: auth.message ?? '无权限' })
      return
    }
    const pool = getPool()
    await pool.query(
      'DELETE FROM shop_recommendations WHERE shop_id = $1 AND listing_id = $2',
      [shopId, listingId]
    )
    res.json({ success: true })
  } catch (e) {
    console.error('[shops DELETE recommendations]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

/** 店铺所有在售商品（商城店铺页「所有产品」tab） */
shopsRouter.get('/:id/products', async (req, res) => {
  try {
    const shopId = req.params.id
    const pool = getPool()
    const r = await pool.query(
      `SELECT sp.id AS listing_id, sp.product_id, sp.price AS listing_price,
              p.product_name, p.main_images, p.selling_price AS product_price
       FROM shop_products sp
       JOIN products p ON p.product_id = sp.product_id
       WHERE sp.shop_id = $1 AND sp.status = 'on'
       ORDER BY sp.listed_at DESC`,
      [shopId]
    )
    const list = r.rows.map((row: Record<string, unknown>) => {
      const mainImages = row.main_images ?? []
      const img = Array.isArray(mainImages) && mainImages[0] ? String(mainImages[0]) : ''
      const price = row.listing_price != null ? Number(row.listing_price) : Number(row.product_price ?? 0)
      return {
        listingId: String(row.listing_id),
        productId: String(row.product_id),
        title: String(row.product_name ?? ''),
        image: img,
        price,
      }
    })
    res.json({ list })
  } catch (e) {
    console.error('[shops products]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

// ---------- 店铺钱包：充值/提现提交 + 申请记录 ----------
shopsRouter.get('/:id/fund-applications', async (req, res) => {
  try {
    const shopId = req.params.id
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : ''
    if (userId) {
      const auth = await assertShopOwnerByUserId(shopId, userId)
      if (!auth.ok) {
        res.status(403).json({ success: false, message: auth.message ?? '无权限' })
        return
      }
    }

    const status =
      req.query.status === 'pending' || req.query.status === 'approved' || req.query.status === 'rejected'
        ? (req.query.status as 'pending' | 'approved' | 'rejected')
        : undefined
    const type =
      req.query.type === 'recharge' || req.query.type === 'withdraw'
        ? (req.query.type as 'recharge' | 'withdraw')
        : undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))

    const { list, total } = await listShopFundApplicationsByShop({ shopId, status, type, page, pageSize })
    res.json({ list, total, page, pageSize })
  } catch (e) {
    console.error('[shops fund-applications]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

// 店铺钱包充值申请：校验店铺交易密码后提交，由后台审核通过后入账
shopsRouter.post('/:id/recharge', async (req, res) => {
  try {
    const shopId = req.params.id
    const body = req.body as { userId?: string; amount?: number; tradePassword?: string; rechargeScreenshotUrl?: string }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    const tradePassword = typeof body.tradePassword === 'string' ? body.tradePassword.trim() : ''
    const rechargeScreenshotUrl = typeof body.rechargeScreenshotUrl === 'string' ? body.rechargeScreenshotUrl.trim() : ''
    const amount = Number(body.amount)

    if (!userId) {
      res.status(400).json({ success: false, message: '缺少用户信息' })
      return
    }
    const auth = await assertShopOwnerByUserId(shopId, userId)
    if (!auth.ok) {
      res.status(403).json({ success: false, message: auth.message ?? '无权限' })
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ success: false, message: '请输入正确的金额' })
      return
    }
    if (!rechargeScreenshotUrl) {
      res.status(400).json({ success: false, message: '请上传交易截图' })
      return
    }
    // 使用店铺独立交易密码，而非用户个人交易密码
    const shopRow = await getPool().query<{ trade_password: string | null }>(
      'SELECT trade_password FROM shops WHERE id = $1',
      [shopId],
    )
    const shopTradePwd = shopRow.rows[0]?.trade_password ?? ''
    if (!shopTradePwd) {
      res.status(400).json({ success: false, message: '请先设置店铺交易密码' })
      return
    }
    if (!tradePassword || tradePassword !== shopTradePwd) {
      res.status(400).json({ success: false, message: '交易密码错误' })
      return
    }

    const { id } = await createShopFundApplication({
      shopId,
      type: 'recharge',
      amount,
      rechargeScreenshotUrl,
    })
    res.status(201).json({ success: true, id })
  } catch (e) {
    console.error('[shops recharge]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

// 店铺钱包提现申请：校验店铺交易密码后提交，由后台审核通过后扣款
shopsRouter.post('/:id/withdraw', async (req, res) => {
  try {
    const shopId = req.params.id
    const body = req.body as { userId?: string; amount?: number; tradePassword?: string; address?: string }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    const tradePassword = typeof body.tradePassword === 'string' ? body.tradePassword.trim() : ''
    const address = typeof body.address === 'string' ? body.address.trim() : ''
    const amount = Number(body.amount)

    if (!userId) {
      res.status(400).json({ success: false, message: '缺少用户信息' })
      return
    }
    const auth = await assertShopOwnerByUserId(shopId, userId)
    if (!auth.ok) {
      res.status(403).json({ success: false, message: auth.message ?? '无权限' })
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ success: false, message: '请输入正确的金额' })
      return
    }
    if (!address) {
      res.status(400).json({ success: false, message: '请填写提现地址' })
      return
    }

    // 使用店铺独立交易密码，而非用户个人交易密码
    const shopPwdRes = await getPool().query<{ trade_password: string | null }>(
      'SELECT trade_password FROM shops WHERE id = $1',
      [shopId],
    )
    const shopTradePwd = shopPwdRes.rows[0]?.trade_password ?? ''
    if (!shopTradePwd) {
      res.status(400).json({ success: false, message: '请先设置店铺交易密码' })
      return
    }
    if (!tradePassword || tradePassword !== shopTradePwd) {
      res.status(400).json({ success: false, message: '交易密码错误' })
      return
    }

    const shop = await getShopById(shopId)
    if (!shop) {
      res.status(404).json({ success: false, message: '店铺不存在' })
      return
    }
    if (shop.walletBalance < amount) {
      res.status(400).json({ success: false, message: '余额不足' })
      return
    }

    const { id } = await createShopFundApplication({
      shopId,
      type: 'withdraw',
      amount,
      withdrawAddress: address,
    })
    res.status(201).json({ success: true, id })
  } catch (e) {
    console.error('[shops withdraw]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

// ---------- 店铺财务报表：资金流水 + 收入/支出汇总 ----------
shopsRouter.get('/:id/finance', async (req, res) => {
  try {
    const shopId = req.params.id
    const daysParam = typeof req.query.days === 'string' ? req.query.days.trim() : ''
    let days = Number(daysParam || '30')
    if (!Number.isFinite(days) || days <= 0) days = 30
    if (days > 365) days = 365

    const pool = getPool()

    // 查询资金流水（按时间范围过滤）
    const logsRes = await pool.query<{
      id: string
      shop_id: string
      type: string
      amount: string
      balance_after: string | null
      remark: string | null
      order_code: string | null
      created_at: string
    }>(
      `SELECT id, shop_id, type, amount::text AS amount, balance_after::text AS balance_after,
              remark, order_code, created_at
       FROM shop_fund_logs
       WHERE shop_id = $1
         AND created_at >= NOW() - ($2::int || ' days')::interval
       ORDER BY created_at DESC`,
      [shopId, days],
    )

    let incomeTotal = 0
    let expenseTotal = 0
    const records = logsRes.rows.map((row) => {
      const amount = Math.round(Number(row.amount ?? 0) * 100) / 100
      if (amount >= 0) incomeTotal += amount
      else expenseTotal += -amount
      const balanceAfter = row.balance_after != null ? Math.round(Number(row.balance_after) * 100) / 100 : null
      return {
        id: String(row.id),
        type: row.type as 'recharge' | 'withdraw' | 'consume' | 'refund',
        amount,
        balanceAfter,
        remark: row.remark ?? '',
        orderNo: row.order_code ?? '',
        createdAt: row.created_at,
      }
    })

    const net = Math.round((incomeTotal - expenseTotal) * 100) / 100

    res.json({
      incomeTotal,
      expenseTotal,
      net,
      days,
      records,
    })
  } catch (e) {
    console.error('[shops finance]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

// ---------- 店铺仪表盘：概要统计 + 近 7 日订单趋势 ----------
shopsRouter.get('/:id/dashboard', async (req, res) => {
  try {
    const shopId = req.params.id
    const pool = getPool()

    // 1. 店铺基础信息
    const shopRes = await pool.query<{
      level: number | null
      credit_score: string
      followers: number | null
      sales: string
      good_rate: string
      visits: number | null
    }>(
      `SELECT level, credit_score, followers, sales, good_rate, visits
       FROM shops
       WHERE id = $1`,
      [shopId],
    )
    if (shopRes.rows.length === 0) {
      res.status(404).json({ success: false, message: '店铺不存在' })
      return
    }
    const s = shopRes.rows[0]
    const creditScore = Number(s.credit_score ?? 0)
    const goodRate = Number(s.good_rate ?? 0)
    const followers = Number(s.followers ?? 0)
    const salesTotal = Number(s.sales ?? 0)
    const visitsTotal = Number(s.visits ?? 0)

    // 2. 商品总数（在售）
    const prodRes = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM shop_products
       WHERE shop_id = $1 AND status = 'on'`,
      [shopId],
    )
    const productCount = parseInt(prodRes.rows[0]?.count ?? '0', 10)

    // 3. 订单汇总 & 今日概况
    const ordersAggRes = await pool.query<{
      total_orders: string
      total_amount: string
      total_profit: string
    }>(
      `SELECT
         count(*)::text AS total_orders,
         COALESCE(SUM(total_amount), 0)::text AS total_amount,
         COALESCE(SUM(profit_amount), 0)::text AS total_profit
       FROM orders
       WHERE shop_id = $1`,
      [shopId],
    )
    const oa = ordersAggRes.rows[0]
    const orderCount = parseInt(oa?.total_orders ?? '0', 10)
    const totalSales = Math.round(Number(oa?.total_amount ?? 0) * 100) / 100
    const totalProfit = Math.round(Number(oa?.total_profit ?? 0) * 100) / 100

    // 今日订单与销售
    const todayAggRes = await pool.query<{
      today_orders: string
      today_amount: string
      today_profit: string
    }>(
      `SELECT
         count(*)::text AS today_orders,
         COALESCE(SUM(total_amount), 0)::text AS today_amount,
         COALESCE(SUM(profit_amount), 0)::text AS today_profit
       FROM orders
       WHERE shop_id = $1
         AND created_at::date = CURRENT_DATE`,
      [shopId],
    )
    const ta = todayAggRes.rows[0]
    const todayOrders = parseInt(ta?.today_orders ?? '0', 10)
    const todaySales = Math.round(Number(ta?.today_amount ?? 0) * 100) / 100
    const todayProfit = Math.round(Number(ta?.today_profit ?? 0) * 100) / 100

    // 4. 待处理订单：买家已付款，但店铺还未完成发货采购（status = 'paid'）
    const pendingOrdersRes = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM orders
       WHERE shop_id = $1
         AND status = 'paid'`,
      [shopId],
    )
    const pendingOrders = parseInt(pendingOrdersRes.rows[0]?.count ?? '0', 10)

    // 5. 待结算金额：预计未来会回款但尚未入账的钱
    const unsettledRes = await pool.query<{ amount: string }>(
      `SELECT COALESCE(SUM(COALESCE(revenue_amount, total_amount)), 0)::text AS amount
       FROM orders
       WHERE shop_id = $1
         AND status NOT IN ('cancelled', 'refunded')
         AND (status <> 'completed' OR revenue_paid_at IS NULL)`,
      [shopId],
    )
    const unsettledAmount = Math.round(Number(unsettledRes.rows[0]?.amount ?? 0) * 100) / 100

    // 6. 近 7 日订单趋势（按日期聚合）
    const trendRes = await pool.query<{
      day: string
      order_count: string
    }>(
      `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day,
              count(*)::text AS order_count
       FROM orders
       WHERE shop_id = $1
         AND created_at::date >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY created_at::date
       ORDER BY day`,
      [shopId],
    )
    const trendMap = new Map<string, number>()
    for (const row of trendRes.rows) {
      const cnt = parseInt(row.order_count ?? '0', 10)
      trendMap.set(row.day, Number.isFinite(cnt) ? cnt : 0)
    }

    const today = new Date()
    const dayLabels: string[] = []
    const ordersSeries: number[] = []
    const weekdayMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const key = `${y}-${m}-${day}`
      const cnt = trendMap.get(key) ?? 0
      dayLabels.push(weekdayMap[d.getDay()])
      ordersSeries.push(cnt)
    }

    res.json({
      productCount,
      totalSales,
      orderCount,
      totalProfit,
      pendingOrders,
      unsettledAmount,
      creditScore,
      goodRate,
      followers,
      visitsTotal,
      todayOrders,
      todaySales,
      todayProfit,
      orderTrend: {
        labels: dayLabels,
        orders: ordersSeries,
      },
    })
  } catch (e) {
    console.error('[shops dashboard]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

shopsRouter.patch('/:id', async (req, res) => {
  try {
    const id = req.params.id
    const body = req.body as {
      userId?: string
      logo?: string | null
      banner?: string | null
      level?: string
      followCount?: number
      sales?: number
      goodRate?: number
      creditScore?: number
      walletBalance?: number
      visits?: number
      status?: 'normal' | 'banned'
    }
    const pool = getPool()

    const fields: string[] = []
    const values: unknown[] = []
    let i = 1

    if (body.logo !== undefined || body.banner !== undefined) {
      const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
      if (!userId) {
        res.status(400).json({ success: false, message: '修改店铺头像或横幅需提供 userId' })
        return
      }
      const auth = await assertShopOwnerByUserId(id, userId)
      if (!auth.ok) {
        res.status(403).json({ success: false, message: auth.message ?? '无权限' })
        return
      }
      const existing = await getShopById(id)
      if (body.logo !== undefined && existing?.logo) {
        await deleteStorageObjectIfOurs(existing.logo)
      }
      if (body.banner !== undefined && existing?.banner) {
        await deleteStorageObjectIfOurs(existing.banner)
      }
    }

    if (body.logo !== undefined) {
      fields.push(`logo = $${i++}`)
      values.push(body.logo === null || body.logo === '' ? null : String(body.logo))
    }
    if (body.banner !== undefined) {
      fields.push(`banner = $${i++}`)
      values.push(body.banner === null || body.banner === '' ? null : String(body.banner))
    }

    let newLevel: number | null = null
    if (body.level !== undefined && body.level !== null) {
      const lv = body.level
      if (typeof lv === 'number' && lv >= 1 && lv <= 4) {
        newLevel = lv
      } else {
        const s = String(lv).trim()
        if (s === '普通') newLevel = 1
        else if (s === '银牌') newLevel = 2
        else if (s === '金牌') newLevel = 3
        else if (s === '钻石') newLevel = 4
      }
      if (newLevel != null) {
        fields.push(`level = $${i++}`)
        values.push(newLevel)
      }
    }
    if (typeof body.followCount === 'number') {
      fields.push(`followers = $${i++}`)
      values.push(Math.max(0, body.followCount))
    }
    if (typeof body.sales === 'number') {
      fields.push(`sales = $${i++}`)
      values.push(Math.max(0, body.sales))
    }
    if (typeof body.goodRate === 'number') {
      fields.push(`good_rate = $${i++}`)
      values.push(Math.min(100, Math.max(0, body.goodRate)))
    }
    if (typeof body.creditScore === 'number') {
      fields.push(`credit_score = $${i++}`)
      values.push(Math.min(100, Math.max(0, body.creditScore)))
    }
    if (typeof body.walletBalance === 'number') {
      fields.push(`wallet_balance = $${i++}`)
      values.push(Math.max(0, body.walletBalance))
    }
    if (typeof body.visits === 'number') {
      fields.push(`visits = $${i++}`)
      values.push(Math.max(0, Math.floor(body.visits)))
    }
    if (body.status === 'normal' || body.status === 'banned') {
      fields.push(`status = $${i++}`)
      values.push(body.status)
    }

    if (fields.length === 0) {
      res.json({ success: true })
      return
    }

    values.push(id)
    const sql = `UPDATE shops SET ${fields.join(', ')} WHERE id = $${i}`
    const result = await pool.query(sql, values)
    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ success: false, message: '店铺不存在' })
      return
    }
    // 等级若被修改，由数据库触发器 trg_shops_level_reprice 自动重算该店所有已上架商品售价，无需此处再算

    res.json({ success: true })
  } catch (e) {
    console.error('[shops patch]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})
