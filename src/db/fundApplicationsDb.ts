import { getPool } from '../db.js'
import { getById as getUserById, updateUser, insertFundLog } from './usersDb.js'

export type FundApplicationType = 'recharge' | 'withdraw'
export type FundApplicationStatus = 'pending' | 'approved' | 'rejected'

export interface FundApplicationRow {
  id: number
  user_id: string
  type: string
  amount: string
  status: string
  created_at: string
  reviewed_at: string | null
  reviewer_id: string | null
  remark: string | null
  recharge_tx_no: string | null
  withdraw_address: string | null
}

function rowToApp(r: FundApplicationRow) {
  const id = Number(r.id)
  const type = r.type as FundApplicationType
  const orderNo =
    type === 'recharge'
      ? 'RCH' + String(id).padStart(8, '0')
      : type === 'withdraw'
        ? 'WD' + String(id).padStart(8, '0')
        : String(id)
  return {
    id,
    userId: r.user_id,
    type,
    amount: Number(r.amount),
    status: r.status as FundApplicationStatus,
    orderNo,
    orderCategory: 'fund' as const,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at ?? null,
    reviewerId: r.reviewer_id ?? null,
    remark: r.remark ?? null,
    rechargeTxNo: r.recharge_tx_no ?? null,
    withdrawAddress: r.withdraw_address ?? null,
  }
}

export async function createFundApplication(params: {
  userId: string
  type: FundApplicationType
  amount: number
  rechargeTxNo?: string | null
  withdrawAddress?: string | null
}): Promise<{ id: number }> {
  const pool = getPool()
  const res = await pool.query<{ id: string }>(
    `INSERT INTO user_fund_applications (user_id, type, amount, status, recharge_tx_no, withdraw_address)
     VALUES ($1, $2, $3, 'pending', $4, $5) RETURNING id`,
    [
      params.userId,
      params.type,
      params.amount,
      params.type === 'recharge' ? params.rechargeTxNo ?? null : null,
      params.type === 'withdraw' ? params.withdrawAddress ?? null : null,
    ]
  )
  return { id: Number(res.rows[0].id) }
}

export async function getFundApplicationById(id: number): Promise<ReturnType<typeof rowToApp> | null> {
  const pool = getPool()
  const res = await pool.query<FundApplicationRow>(
    'SELECT id, user_id, type, amount, status, created_at, reviewed_at, reviewer_id, remark, recharge_tx_no, withdraw_address FROM user_fund_applications WHERE id = $1',
    [id]
  )
  if (res.rows.length === 0) return null
  return rowToApp(res.rows[0])
}

/** 用户查看自己的申请列表 */
export async function listFundApplicationsByUser(
  userId: string,
  opts: { status?: FundApplicationStatus; page?: number; pageSize?: number } = {}
): Promise<{ list: ReturnType<typeof rowToApp>[]; total: number }> {
  const pool = getPool()
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20))
  const status = opts.status

  let countSql = 'SELECT count(*)::text AS count FROM user_fund_applications WHERE user_id = $1'
  const countParams: unknown[] = [userId]
  if (status) {
    countSql += ' AND status = $2'
    countParams.push(status)
  }
  const countRes = await pool.query<{ count: string }>(countSql, countParams)
  const total = parseInt(countRes.rows[0]?.count ?? '0', 10)

  let listSql = `SELECT id, user_id, type, amount, status, created_at, reviewed_at, reviewer_id, remark
    , recharge_tx_no, withdraw_address
    FROM user_fund_applications WHERE user_id = $1`
  const listParams: unknown[] = [userId]
  if (status) {
    listSql += ' AND status = $2'
    listParams.push(status)
  }
  listSql += ' ORDER BY created_at DESC LIMIT $' + (listParams.length + 1) + ' OFFSET $' + (listParams.length + 2)
  listParams.push(pageSize, (page - 1) * pageSize)
  const res = await pool.query<FundApplicationRow>(listSql, listParams)
  return { list: res.rows.map(rowToApp), total }
}

/** 管理后台：待审核/全部申请列表（支持类型筛选与关键字搜索） */
export async function listFundApplicationsForAdmin(opts: {
  status?: FundApplicationStatus
  type?: FundApplicationType
  page?: number
  pageSize?: number
  keyword?: string
} = {}): Promise<{ list: Array<ReturnType<typeof rowToApp> & { userAccount?: string | null }>; total: number }> {
  const pool = getPool()
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20))
  const status = opts.status
  const type = opts.type
  const keyword = (opts.keyword ?? '').trim()

  // 统计总数
  let countSql = `SELECT count(*)::text AS count
    FROM user_fund_applications a
    LEFT JOIN users u ON u.id = a.user_id`
  const countParams: unknown[] = []
  const countConds: string[] = []
  let i = 1
  if (status) {
    countConds.push(`a.status = $${i}`)
    countParams.push(status)
    i += 1
  }
  if (type) {
    countConds.push(`a.type = $${i}`)
    countParams.push(type)
    i += 1
  }
  if (keyword) {
    countConds.push(
      `(a.id::text ILIKE $${i} OR a.user_id ILIKE $${i} OR coalesce(u.account, '') ILIKE $${i}
        OR coalesce(a.recharge_tx_no, '') ILIKE $${i} OR coalesce(a.withdraw_address, '') ILIKE $${i})`
    )
    countParams.push(`%${keyword}%`)
    i += 1
  }
  if (countConds.length > 0) {
    countSql += ' WHERE ' + countConds.join(' AND ')
  }
  const countRes = await pool.query<{ count: string }>(countSql, countParams)
  const total = parseInt(countRes.rows[0]?.count ?? '0', 10)

  // 查询列表
  let listSql = `SELECT a.id, a.user_id, a.type, a.amount, a.status, a.created_at, a.reviewed_at, a.reviewer_id, a.remark,
    a.recharge_tx_no, a.withdraw_address,
    u.account AS user_account
    FROM user_fund_applications a
    LEFT JOIN users u ON u.id = a.user_id`
  const listParams: unknown[] = []
  const listConds: string[] = []
  let j = 1
  if (status) {
    listConds.push(`a.status = $${j}`)
    listParams.push(status)
    j += 1
  }
  if (type) {
    listConds.push(`a.type = $${j}`)
    listParams.push(type)
    j += 1
  }
  if (keyword) {
    listConds.push(
      `(a.id::text ILIKE $${j} OR a.user_id ILIKE $${j} OR coalesce(u.account, '') ILIKE $${j}
        OR coalesce(a.recharge_tx_no, '') ILIKE $${j} OR coalesce(a.withdraw_address, '') ILIKE $${j})`
    )
    listParams.push(`%${keyword}%`)
    j += 1
  }
  if (listConds.length > 0) {
    listSql += ' WHERE ' + listConds.join(' AND ')
  }
  listSql += ' ORDER BY a.created_at DESC LIMIT $' + j + ' OFFSET $' + (j + 1)
  listParams.push(pageSize, (page - 1) * pageSize)
  const res = await pool.query<FundApplicationRow & { user_account: string | null }>(listSql, listParams)
  const list = res.rows.map((row) => {
    const base = rowToApp(row)
    return { ...base, userAccount: row.user_account ?? null }
  })
  return { list, total }
}

export async function approveFundApplication(
  applicationId: number,
  reviewerId?: string
): Promise<{ success: boolean; message?: string }> {
  const app = await getFundApplicationById(applicationId)
  if (!app) return { success: false, message: '申请不存在' }
  if (app.status !== 'pending') return { success: false, message: '申请已处理' }
  const user = await getUserById(app.userId)
  if (!user) return { success: false, message: '用户不存在' }

  const amount = app.amount
  const now = new Date().toISOString()

  if (app.type === 'recharge') {
    const balanceAfter = user.balance + amount
    await updateUser(app.userId, { balance: balanceAfter })
    await insertFundLog({
      userId: app.userId,
      type: 'recharge',
      amount,
      balanceAfter,
      relatedId: String(applicationId),
      remark: '充值（审核通过）',
    })
  } else {
    if (user.balance < amount) return { success: false, message: '用户余额不足，无法通过提现' }
    const balanceAfter = user.balance - amount
    await updateUser(app.userId, { balance: balanceAfter })
    await insertFundLog({
      userId: app.userId,
      type: 'withdraw',
      amount: -amount,
      balanceAfter,
      relatedId: String(applicationId),
      remark: '提现（审核通过）',
    })
  }

  const pool = getPool()
  await pool.query(
    `UPDATE user_fund_applications SET status = 'approved', reviewed_at = $1, reviewer_id = $2 WHERE id = $3`,
    [now, reviewerId ?? null, applicationId]
  )
  return { success: true }
}

export async function rejectFundApplication(
  applicationId: number,
  opts: { reviewerId?: string; remark?: string } = {}
): Promise<{ success: boolean; message?: string }> {
  const app = await getFundApplicationById(applicationId)
  if (!app) return { success: false, message: '申请不存在' }
  if (app.status !== 'pending') return { success: false, message: '申请已处理' }

  const pool = getPool()
  const now = new Date().toISOString()
  await pool.query(
    `UPDATE user_fund_applications SET status = 'rejected', reviewed_at = $1, reviewer_id = $2, remark = $3 WHERE id = $4`,
    [now, opts.reviewerId ?? null, opts.remark ?? null, applicationId]
  )
  return { success: true }
}
