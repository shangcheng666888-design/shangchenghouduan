import { getPool } from '../db.js'

export interface ShopApplicationRow {
  id: string
  store_name: string
  store_address: string
  country: string
  id_number: string
  real_name: string
  email: string
  password: string
  invitation_code: string
  logo: string | null
  id_front: string | null
  id_back: string | null
  id_handheld: string | null
  signature: string | null
  status: string
  created_at: string
  user_id: string | null
}

function rowToApply(r: ShopApplicationRow) {
  return {
    id: r.id,
    storeName: r.store_name,
    storeAddress: r.store_address,
    country: r.country,
    idNumber: r.id_number,
    realName: r.real_name,
    email: r.email,
    password: r.password,
    invitationCode: r.invitation_code || '',
    logo: r.logo ?? '',
    idFront: r.id_front ?? '',
    idBack: r.id_back ?? '',
    idHandheld: r.id_handheld ?? '',
    signature: r.signature ?? '',
    status: r.status as 'pending' | 'approved' | 'rejected',
    applyTime: r.created_at,
    userId: r.user_id ?? null,
  }
}

/** 生成下一个 SA10001 格式申请单 ID */
export async function nextApplicationId(): Promise<string> {
  const pool = getPool()
  const res = await pool.query<{ id: string }>(
    "SELECT id FROM shop_applications WHERE id ~ '^SA[0-9]{5}$' ORDER BY id DESC LIMIT 1"
  )
  let nextNum = 10001
  if (res.rows.length > 0) {
    const m = res.rows[0].id.match(/^SA(\d{5})$/)
    if (m) nextNum = parseInt(m[1], 10) + 1
  }
  return 'SA' + String(nextNum)
}

export async function createShopApplication(params: {
  id: string
  storeName: string
  storeAddress: string
  country: string
  idNumber: string
  realName: string
  email: string
  password: string
  invitationCode?: string
  logo?: string | null
  idFront?: string | null
  idBack?: string | null
  idHandheld?: string | null
  signature?: string | null
  userId?: string | null
}): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO shop_applications (id, store_name, store_address, country, id_number, real_name, email, password, invitation_code, logo, id_front, id_back, id_handheld, signature, status, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending', $15)`,
    [
      params.id,
      params.storeName,
      params.storeAddress,
      params.country,
      params.idNumber,
      params.realName,
      params.email,
      params.password,
      params.invitationCode ?? '',
      params.logo ?? null,
      params.idFront ?? null,
      params.idBack ?? null,
      params.idHandheld ?? null,
      params.signature ?? null,
      params.userId ?? null,
    ]
  )
}

export async function getApplicationById(id: string): Promise<ReturnType<typeof rowToApply> | null> {
  const pool = getPool()
  const res = await pool.query<ShopApplicationRow>(
    'SELECT id, store_name, store_address, country, id_number, real_name, email, password, invitation_code, logo, id_front, id_back, id_handheld, signature, status, created_at, user_id FROM shop_applications WHERE id = $1',
    [id]
  )
  if (res.rows.length === 0) return null
  return rowToApply(res.rows[0])
}

export async function listPendingApplications(): Promise<
  Array<ReturnType<typeof rowToApply> & { applyAccount?: string | null }>
> {
  const pool = getPool()
  const res = await pool.query<
    ShopApplicationRow & {
      user_account: string | null
    }
  >(
    `SELECT
       a.id,
       a.store_name,
       a.store_address,
       a.country,
       a.id_number,
       a.real_name,
       a.email,
       a.password,
       a.invitation_code,
       a.logo,
       a.id_front,
       a.id_back,
       a.id_handheld,
       a.signature,
       a.status,
       a.created_at,
       a.user_id,
       u.account AS user_account
     FROM shop_applications a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC`
  )
  return res.rows.map((row) => ({
    ...rowToApply(row),
    applyAccount: row.user_account,
  }))
}

export async function setApplicationStatus(
  id: string,
  status: 'approved' | 'rejected'
): Promise<boolean> {
  const pool = getPool()
  const res = await pool.query(
    'UPDATE shop_applications SET status = $1 WHERE id = $2 AND status = $3',
    [status, id, 'pending']
  )
  return (res.rowCount ?? 0) > 0
}
