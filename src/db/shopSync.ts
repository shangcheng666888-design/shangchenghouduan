import { getPool } from '../db.js'
import { publishMerchantSync, type MerchantSyncTopic } from './merchantEventHub.js'

/** 递增店铺 data_version 并推送 SSE（单实例；多实例需 Redis pub/sub） */
export async function bumpShopDataVersion(
  shopId: string,
  topics: MerchantSyncTopic[] = ['all'],
): Promise<number> {
  const pool = getPool()
  const res = await pool.query<{ data_version: string }>(
    `UPDATE shops
     SET data_version = COALESCE(data_version, 0) + 1
     WHERE id = $1
     RETURNING data_version`,
    [shopId],
  )
  const version = Number(res.rows[0]?.data_version ?? 0)
  if (version > 0) {
    publishMerchantSync(shopId, version, topics)
  }
  return version
}

export async function getShopSyncSnapshot(shopId: string) {
  const pool = getPool()
  const shopRes = await pool.query<{
    data_version: string
    status: string
    ban_reason: string | null
    ban_notice: string | null
    banned_at: string | null
    name: string
    wallet_balance: string
    level: number
    credit_score: string
    good_rate: string
    followers: number
    sales: number
    visits: number
  }>(
    `SELECT data_version, status, ban_reason, ban_notice, banned_at, name,
            wallet_balance, level, credit_score, good_rate, followers, sales, visits
     FROM shops WHERE id = $1`,
    [shopId],
  )
  if (shopRes.rows.length === 0) return null

  const row = shopRes.rows[0]
  const pendingRes = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM orders WHERE shop_id = $1 AND status = 'paid'`,
    [shopId],
  )

  return {
    version: Number(row.data_version ?? 1),
    status: row.status ?? 'normal',
    banReason: row.ban_reason ?? null,
    banNotice: row.ban_notice ?? null,
    bannedAt: row.banned_at ?? null,
    name: row.name,
    walletBalance: Number(row.wallet_balance ?? 0),
    level: Number(row.level ?? 1),
    creditScore: Number(row.credit_score ?? 0),
    goodRate: Number(row.good_rate ?? 0),
    followers: Number(row.followers ?? 0),
    sales: Number(row.sales ?? 0),
    visits: Number(row.visits ?? 0),
    pendingOrders: parseInt(pendingRes.rows[0]?.count ?? '0', 10),
  }
}
