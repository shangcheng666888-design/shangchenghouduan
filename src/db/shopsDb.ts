import { getPool } from '../db.js'

export interface ShopRow {
  id: string
  name: string
  owner_id: string
  status: string
  logo: string | null
  banner: string | null
  address: string | null
  country: string | null
  credit_score: string
  wallet_balance: string
  level: number
  followers: number
  sales: number
  good_rate: string
  visits: number
  last_login_ip: string | null
  last_login_country: string | null
  created_at: string
}

function rowToShop(r: ShopRow) {
  return {
    id: r.id,
    name: r.name,
    ownerId: r.owner_id,
    logo: r.logo ?? null,
    banner: r.banner ?? null,
    address: r.address ?? null,
    country: r.country ?? null,
    status: r.status as 'normal' | 'banned',
    creditScore: Number(r.credit_score),
    walletBalance: Number(r.wallet_balance),
    level: r.level,
    followers: r.followers,
    sales: r.sales,
    goodRate: Number(r.good_rate),
    visits: Number(r.visits ?? 0),
    lastLoginIp: r.last_login_ip ?? null,
    lastLoginCountry: r.last_login_country ?? null,
    createdAt: r.created_at,
  }
}

/** 生成下一个 S10001 格式店铺 ID */
export async function nextShopId(): Promise<string> {
  const pool = getPool()
  const res = await pool.query<{ id: string }>(
    "SELECT id FROM shops WHERE id ~ '^S[0-9]{5}$' ORDER BY id DESC LIMIT 1"
  )
  let nextNum = 10001
  if (res.rows.length > 0) {
    const m = res.rows[0].id.match(/^S(\d{5})$/)
    if (m) nextNum = parseInt(m[1], 10) + 1
  }
  return 'S' + String(nextNum)
}

export async function createShop(params: {
  id: string
  name: string
  ownerId: string
  status?: 'normal' | 'banned'
  logo?: string | null
  banner?: string | null
  address?: string | null
  country?: string | null
  creditScore?: number
  walletBalance?: number
  level?: number
  followers?: number
  sales?: number
  goodRate?: number
  visits?: number
}): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO shops (id, name, owner_id, status, logo, banner, address, country, credit_score, wallet_balance, level, followers, sales, good_rate, visits)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      params.id,
      params.name,
      params.ownerId,
      params.status ?? 'normal',
      params.logo ?? null,
      params.banner ?? null,
      params.address ?? null,
      params.country ?? null,
      params.creditScore ?? 100,
      params.walletBalance ?? 0,
      params.level ?? 1,
      params.followers ?? 0,
      params.sales ?? 0,
      params.goodRate ?? 100,
      params.visits ?? 0,
    ]
  )
}

export async function getShopById(id: string): Promise<ReturnType<typeof rowToShop> | null> {
  const pool = getPool()
  const res = await pool.query<ShopRow>(
    'SELECT id, name, owner_id, status, logo, banner, address, country, credit_score, wallet_balance, level, followers, sales, good_rate, visits, last_login_ip, last_login_country, created_at FROM shops WHERE id = $1',
    [id]
  )
  if (res.rows.length === 0) return null
  return rowToShop(res.rows[0])
}

export async function listShops(opts?: { shopId?: string }): Promise<ReturnType<typeof rowToShop>[]> {
  const pool = getPool()
  let sql =
    'SELECT id, name, owner_id, status, logo, banner, address, country, credit_score, wallet_balance, level, followers, sales, good_rate, visits, last_login_ip, last_login_country, created_at FROM shops WHERE 1=1'
  const params: unknown[] = []
  if (opts?.shopId) {
    params.push(opts.shopId)
    sql += ` AND id = $${params.length}`
  }
  sql += ' ORDER BY created_at DESC'
  const res = await pool.query<ShopRow>(sql, params)
  return res.rows.map(rowToShop)
}
