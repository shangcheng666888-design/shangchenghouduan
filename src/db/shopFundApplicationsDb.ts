import { getPool } from '../db.ts'
import { getById as getUserById } from './usersDb.js'
import { getShopById } from './shopsDb.js'

export type ShopFundApplicationType = 'recharge' | 'withdraw'
export type ShopFundApplicationStatus = 'pending' | 'approved' | 'rejected'

export interface ShopFundApplicationRow {
  id: number
  shop_id: string
  type: string
  amount: string
  status: string
  recharge_tx_no: string | null
  withdraw_address: string | null
  reviewed_at: string | null
  reviewer_id: string | null
  remark: string | null
  created_at: string
}

function pad8(n: number): string {
  return String(n).padStart(8, '0')
}

function normalizeStatus(s: string): ShopFundApplicationStatus {
  if (s === 'approved' || s === 'rejected') return s
  return 'pending'
}

function rowToApp(r: ShopFundApplicationRow) {
  const type = r.type === 'withdraw' ? ('withdraw' as const) : ('recharge' as const)
  return {
    id: r.id,
    shopId: r.shop_id,
    type,
    amount: Number(r.amount ?? 0),
    status: normalizeStatus(r.status),
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    reviewerId: r.reviewer_id,
    remark: r.remark,
    rechargeTxNo: r.recharge_tx_no,
    withdrawAddress: r.withdraw_address,
    orderNo: type === 'recharge' ? `SRCH${pad8(r.id)}` : `SWD${pad8(r.id)}`,
  }
}

function generateOrderCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let suffix = ''
  for (let i = 0; i < 5; i += 1) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return `R${suffix}`
}

async function insertShopFundLog(params: {
  shopId: string
  type: 'recharge' | 'withdraw' | 'consume' | 'refund'
  amount: number
  balanceAfter?: number
  relatedId?: string
  remark?: string
  orderCode?: string
}): Promise<string> {
  const pool = getPool()
  const orderCode = params.orderCode ?? generateOrderCode()
  await pool.query(
    `INSERT INTO shop_fund_logs (shop_id, type, amount, balance_after, related_id, remark, order_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.shopId,
      params.type,
      params.amount,
      params.balanceAfter ?? null,
      params.relatedId ?? null,
      params.remark ?? null,
      orderCode,
    ]
  )
  return orderCode
}

export async function createShopFundApplication(params: {
  shopId: string
  type: ShopFundApplicationType
  amount: number
  rechargeTxNo?: string | null
  withdrawAddress?: string | null
}): Promise<{ id: number }> {
  const pool = getPool()
  const res = await pool.query<{ id: number }>(
    `INSERT INTO shop_fund_applications (shop_id, type, amount, status, recharge_tx_no, withdraw_address)
     VALUES ($1, $2, $3, 'pending', $4, $5)
     RETURNING id`,
    [
      params.shopId,
      params.type,
      params.amount,
      params.rechargeTxNo ?? null,
      params.withdrawAddress ?? null,
    ]
  )
  return { id: Number(res.rows[0]?.id) }
}

export async function listShopFundApplicationsByShop(opts: {
  shopId: string
  status?: ShopFundApplicationStatus
  type?: ShopFundApplicationType
  page: number
  pageSize: number
}): Promise<{ list: ReturnType<typeof rowToApp>[]; total: number }> {
  const pool = getPool()
  const page = Math.max(1, Number(opts.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 20))
  const status = opts.status
  const type = opts.type

  const whereParts: string[] = ['shop_id = $1']
  const params: unknown[] = [opts.shopId]
  if (status) {
    params.push(status)
    whereParts.push(`status = $${params.length}`)
  }
  if (type) {
    params.push(type)
    whereParts.push(`type = $${params.length}`)
  }
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''

  const countRes = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM shop_fund_applications ${where}`,
    params
  )
  const total = parseInt(countRes.rows[0]?.count ?? '0', 10)

  const offset = (page - 1) * pageSize
  const listRes = await pool.query<ShopFundApplicationRow>(
    `SELECT id, shop_id, type, amount::text AS amount, status, recharge_tx_no, withdraw_address, reviewed_at, reviewer_id, remark, created_at
     FROM shop_fund_applications
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  )

  return { list: listRes.rows.map(rowToApp), total }
}

export async function listShopFundApplicationsForAdmin(opts: {
  status?: ShopFundApplicationStatus
  type?: ShopFundApplicationType
  page: number
  pageSize: number
  keyword?: string
}): Promise<{
  list: Array<
    ReturnType<typeof rowToApp> & {
      shopName?: string | null
      ownerId?: string | null
      ownerAccount?: string | null
    }
  >
  total: number
}> {
  const pool = getPool()
  const page = Math.max(1, Number(opts.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 20))
  const keyword = opts.keyword?.trim()

  const params: unknown[] = []
  const whereParts: string[] = ['1=1']
  if (opts.status) {
    params.push(opts.status)
    whereParts.push(`a.status = $${params.length}`)
  }
  if (opts.type) {
    params.push(opts.type)
    whereParts.push(`a.type = $${params.length}`)
  }
  if (keyword) {
    params.push(`%${keyword}%`)
    const p = `$${params.length}`
    whereParts.push(
      `(a.shop_id ILIKE ${p} OR s.name ILIKE ${p} OR u.account ILIKE ${p} OR COALESCE(a.recharge_tx_no,'') ILIKE ${p} OR COALESCE(a.withdraw_address,'') ILIKE ${p})`
    )
  }
  const where = `WHERE ${whereParts.join(' AND ')}`

  const countRes = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM shop_fund_applications a
     LEFT JOIN shops s ON s.id = a.shop_id
     LEFT JOIN users u ON u.id = s.owner_id
     ${where}`,
    params
  )
  const total = parseInt(countRes.rows[0]?.count ?? '0', 10)

  const offset = (page - 1) * pageSize
  const listRes = await pool.query<
    ShopFundApplicationRow & { shop_name: string | null; owner_id: string | null; owner_account: string | null }
  >(
    `SELECT
        a.id,
        a.shop_id,
        a.type,
        a.amount::text AS amount,
        a.status,
        a.recharge_tx_no,
        a.withdraw_address,
        a.reviewed_at,
        a.reviewer_id,
        a.remark,
        a.created_at,
        s.name AS shop_name,
        s.owner_id AS owner_id,
        u.account AS owner_account
     FROM shop_fund_applications a
     LEFT JOIN shops s ON s.id = a.shop_id
     LEFT JOIN users u ON u.id = s.owner_id
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  )

  const list = listRes.rows.map((r) => ({
    ...rowToApp(r),
    shopName: r.shop_name,
    ownerId: r.owner_id,
    ownerAccount: r.owner_account,
  }))
  return { list, total }
}

export async function approveShopFundApplication(
  applicationId: number,
  opts?: { reviewerId?: string }
): Promise<{ success: boolean; message?: string }> {
  const pool = getPool()
  const res = await pool.query<ShopFundApplicationRow>(
    `SELECT id, shop_id, type, amount::text AS amount, status, recharge_tx_no, withdraw_address, reviewed_at, reviewer_id, remark, created_at
     FROM shop_fund_applications
     WHERE id = $1`,
    [applicationId]
  )
  if (res.rows.length === 0) return { success: false, message: '申请不存在' }
  const app = rowToApp(res.rows[0])
  if (app.status !== 'pending') return { success: false, message: '申请已处理' }

  const shop = await getShopById(app.shopId)
  if (!shop) return { success: false, message: '店铺不存在' }

  const amount = Number(app.amount ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, message: '金额不合法' }

  if (app.type === 'withdraw' && shop.walletBalance < amount) {
    return { success: false, message: '店铺余额不足' }
  }

  const balanceAfter = app.type === 'recharge' ? shop.walletBalance + amount : shop.walletBalance - amount

  await pool.query('UPDATE shops SET wallet_balance = $1 WHERE id = $2', [
    balanceAfter,
    app.shopId,
  ])

  await insertShopFundLog({
    shopId: app.shopId,
    type: app.type,
    amount: app.type === 'recharge' ? amount : -amount,
    balanceAfter,
    relatedId: String(applicationId),
    remark: app.type === 'recharge' ? '店铺充值（审核通过）' : '店铺提现（审核通过）',
  })

  const now = new Date().toISOString()
  await pool.query(
    `UPDATE shop_fund_applications
     SET status = 'approved', reviewed_at = $1, reviewer_id = $2
     WHERE id = $3`,
    [now, opts?.reviewerId ?? null, applicationId]
  )
  return { success: true }
}

export async function rejectShopFundApplication(
  applicationId: number,
  opts?: { remark?: string; reviewerId?: string }
): Promise<{ success: boolean; message?: string }> {
  const pool = getPool()
  const res = await pool.query<{ status: string }>(
    'SELECT status FROM shop_fund_applications WHERE id = $1',
    [applicationId]
  )
  if (res.rows.length === 0) return { success: false, message: '申请不存在' }
  const status = normalizeStatus(res.rows[0].status)
  if (status !== 'pending') return { success: false, message: '申请已处理' }

  const now = new Date().toISOString()
  await pool.query(
    `UPDATE shop_fund_applications
     SET status = 'rejected', reviewed_at = $1, reviewer_id = $2, remark = $3
     WHERE id = $4`,
    [now, opts?.reviewerId ?? null, opts?.remark ?? null, applicationId]
  )
  return { success: true }
}

export async function assertShopOwnerByUserId(shopId: string, userId: string): Promise<{ ok: boolean; message?: string }> {
  const user = await getUserById(userId)
  if (!user) return { ok: false, message: '用户不存在' }
  if (!user.shopId || user.shopId !== shopId) return { ok: false, message: '无权限操作该店铺' }
  return { ok: true }
}

