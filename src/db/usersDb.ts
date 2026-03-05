import { getPool } from '../db.js'

const AVATAR_OPTIONS = [
  ...Array.from({ length: 15 }, (_, i) => `/avatars/avatar${i + 1}.png`),
  '/avatars/avatar18.png',
  '/avatars/avatar19.png',
  '/avatars/avatar20.png',
  '/avatars/avatar21.png',
  '/avatars/avatar22.png',
]

export function getRandomAvatar(): string {
  const i = Math.floor(Math.random() * AVATAR_OPTIONS.length)
  return AVATAR_OPTIONS[i]!
}

export function isValidAvatar(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false
  return AVATAR_OPTIONS.includes(url.trim())
}

export interface UserRow {
  id: string
  account: string
  password: string
  balance: number
  trade_password: string | null
  addresses: unknown[]
  shop_id: string | null
  is_bot: boolean
  status: string | null
  avatar: string | null
  created_at: string
}

function rowToUser(r: UserRow) {
  return {
    id: r.id,
    account: r.account,
    password: r.password,
    balance: Number(r.balance),
    tradePassword: r.trade_password ?? undefined,
    addresses: Array.isArray(r.addresses) ? r.addresses : [],
    shopId: r.shop_id,
    isBot: r.is_bot ?? false,
    status: (r.status as 'normal' | 'disabled' | null) ?? 'normal',
    avatar: r.avatar ?? undefined,
    createdAt: r.created_at,
  }
}

export async function getByAccount(account: string): Promise<ReturnType<typeof rowToUser> | null> {
  const pool = getPool()
  const res = await pool.query<UserRow>(
    'SELECT id, account, password, balance, trade_password, addresses, shop_id, is_bot, status, avatar, created_at FROM users WHERE account = $1',
    [account.trim()]
  )
  if (res.rows.length === 0) return null
  return rowToUser(res.rows[0])
}

export async function getById(id: string): Promise<ReturnType<typeof rowToUser> | null> {
  const pool = getPool()
  const res = await pool.query<UserRow>(
    'SELECT id, account, password, balance, trade_password, addresses, shop_id, is_bot, status, avatar, created_at FROM users WHERE id = $1',
    [id]
  )
  if (res.rows.length === 0) return null
  return rowToUser(res.rows[0])
}

/** 生成下一个 U10001 格式的唯一 ID */
export async function nextUserId(): Promise<string> {
  const pool = getPool()
  const res = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE id ~ '^U[0-9]{5}$' ORDER BY id DESC LIMIT 1"
  )
  let nextNum = 10001
  if (res.rows.length > 0) {
    const m = res.rows[0].id.match(/^U(\d{5})$/)
    if (m) nextNum = parseInt(m[1], 10) + 1
  }
  return 'U' + String(nextNum)
}

export async function createUser(params: {
  id: string
  account: string
  password: string
  balance?: number
  tradePassword?: string
  addresses?: unknown[]
  shopId?: string | null
  isBot?: boolean
  avatar?: string | null
  createdAt?: string
}): Promise<void> {
  const pool = getPool()
  const avatar = params.avatar != null
    ? (isValidAvatar(params.avatar) ? params.avatar : getRandomAvatar())
    : getRandomAvatar()
  await pool.query(
    `INSERT INTO users (id, account, password, balance, trade_password, addresses, shop_id, is_bot, status, avatar, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      params.id,
      params.account,
      params.password,
      params.balance ?? 0,
      params.tradePassword ?? null,
      JSON.stringify(params.addresses ?? []),
      params.shopId ?? null,
      params.isBot ?? false,
      'normal',
      avatar,
      params.createdAt ?? new Date().toISOString(),
    ]
  )
}

export async function listUsers(opts: {
  page: number
  pageSize: number
  search?: string
  status?: 'normal' | 'disabled'
}): Promise<{
  list: Array<{ id: string; account: string; balance: number; shopId: string | null; isBot: boolean; createdAt: string; status: 'normal' | 'disabled' }>
  total: number
}> {
  const pool = getPool()
  const page = Math.max(1, opts.page)
  const pageSize = Math.min(100, Math.max(1, opts.pageSize))
  const search = opts.search?.trim()
  const status = opts.status

  let countSql = 'SELECT count(*)::text AS count FROM users WHERE 1=1'
  const countParams: unknown[] = []
  if (status) {
    countSql += ` AND status = $${countParams.length + 1}`
    countParams.push(status)
  }
  if (search) {
    countSql += ` AND (id ILIKE $${countParams.length + 1} OR account ILIKE $${countParams.length + 1})`
    countParams.push(`%${search}%`)
  }
  const countRes = await pool.query<{ count: string }>(countSql, countParams)
  const total = parseInt(countRes.rows[0]?.count ?? '0', 10)

  const offset = (page - 1) * pageSize
  const res = await pool.query<UserRow>(
    `SELECT id, account, password, balance, trade_password, addresses, shop_id, is_bot, status, created_at
     FROM users
     WHERE 1=1
     ${status ? ' AND status = $1' : ''}
     ${search ? (status ? ' AND (id ILIKE $2 OR account ILIKE $2)' : ' AND (id ILIKE $1 OR account ILIKE $1)') : ''}
     ORDER BY created_at DESC
     LIMIT $${(status ? 2 : 1) + (search ? 1 : 0)} OFFSET $${(status ? 2 : 1) + (search ? 2 : 1)}`,
    status && search
      ? [status, `%${search}%`, pageSize, offset]
      : status
      ? [status, pageSize, offset]
      : search
      ? [`%${search}%`, pageSize, offset]
      : [pageSize, offset]
  )
  const list = res.rows.map((r) => ({
    id: r.id,
    account: r.account,
    balance: Number(r.balance),
    shopId: r.shop_id,
    isBot: r.is_bot ?? false,
    createdAt: r.created_at,
    status: (r.status as 'normal' | 'disabled' | null) ?? 'normal',
  }))
  return { list, total }
}

export async function updateUser(
  id: string,
  updates: {
    balance?: number
    tradePassword?: string
    password?: string
    addresses?: unknown[]
    shopId?: string | null
    isBot?: boolean
    status?: 'normal' | 'disabled'
    avatar?: string | null
  }
): Promise<boolean> {
  const pool = getPool()
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1
  if (typeof updates.balance === 'number') {
    fields.push(`balance = $${i++}`)
    values.push(updates.balance)
  }
  if (updates.tradePassword !== undefined) {
    fields.push(`trade_password = $${i++}`)
    values.push(updates.tradePassword || null)
  }
  if (typeof updates.password === 'string') {
    fields.push(`password = $${i++}`)
    values.push(updates.password)
  }
  if (Array.isArray(updates.addresses)) {
    fields.push(`addresses = $${i++}`)
    values.push(JSON.stringify(updates.addresses))
  }
  if (updates.shopId !== undefined) {
    fields.push(`shop_id = $${i++}`)
    values.push(updates.shopId)
  }
  if (updates.isBot !== undefined) {
    fields.push(`is_bot = $${i++}`)
    values.push(!!updates.isBot)
  }
  if (updates.status !== undefined) {
    fields.push(`status = $${i++}`)
    values.push(updates.status)
  }
  if (updates.avatar !== undefined) {
    const v = updates.avatar
    fields.push(`avatar = $${i++}`)
    values.push(isValidAvatar(v) ? v : null)
  }
  if (fields.length === 0) return true
  values.push(id)
  const res = await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`,
    values
  )
  return (res.rowCount ?? 0) > 0
}

/** 资金变动类型：recharge=充值, withdraw=提现, consume=消费(下单), refund=退款 */
export type FundLogType = 'recharge' | 'withdraw' | 'consume' | 'refund'

export interface FundLogRow {
  id: number
  user_id: string
  type: string
  amount: string
  balance_after: string | null
  related_id: string | null
  remark: string | null
  created_at: string
  order_code: string | null
}

function generateOrderCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let suffix = ''
  for (let i = 0; i < 5; i += 1) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return `R${suffix}`
}

export async function insertFundLog(params: {
  userId: string
  type: FundLogType
  amount: number
  balanceAfter?: number
  relatedId?: string
  remark?: string
  orderCode?: string
}): Promise<string> {
  const pool = getPool()
  const orderCode = params.orderCode ?? generateOrderCode()
  await pool.query(
    `INSERT INTO user_fund_logs (user_id, type, amount, balance_after, related_id, remark, order_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.userId,
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

export async function listFundLogs(
  userId: string,
  opts: { type?: FundLogType; page?: number; pageSize?: number } = {}
): Promise<{
  list: Array<{
    id: number
    type: string
    amount: number
    balanceAfter: number | null
    relatedId: string | null
    remark: string | null
    createdAt: string
    orderCode: string | null
  }>
  total: number
}> {
  const pool = getPool()
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20))
  const type = opts.type

  let countSql = 'SELECT count(*)::text AS count FROM user_fund_logs WHERE user_id = $1'
  const countParams: unknown[] = [userId]
  if (type) {
    countSql += ' AND type = $2'
    countParams.push(type)
  }
  const countRes = await pool.query<{ count: string }>(countSql, countParams)
  const total = parseInt(countRes.rows[0]?.count ?? '0', 10)

  let listSql = `SELECT id, user_id, type, amount, balance_after, related_id, remark, created_at, order_code
    FROM user_fund_logs WHERE user_id = $1`
  const listParams: unknown[] = [userId]
  if (type) {
    listSql += ' AND type = $2'
    listParams.push(type)
  }
  listSql += ' ORDER BY created_at DESC LIMIT $' + (listParams.length + 1) + ' OFFSET $' + (listParams.length + 2)
  listParams.push(pageSize, (page - 1) * pageSize)

  const res = await pool.query<FundLogRow>(listSql, listParams)
  const list = res.rows.map((r) => ({
    id: Number(r.id),
    type: r.type,
    amount: Number(r.amount),
    balanceAfter: r.balance_after != null ? Number(r.balance_after) : null,
    relatedId: r.related_id,
    remark: r.remark,
    createdAt: r.created_at,
    orderCode: r.order_code,
  }))
  return { list, total }
}
