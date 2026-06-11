import { getPool } from '../db.js'

export type PaidChannel = 'tiktok' | 'meta' | 'google' | 'other'
export type PromoStatus = 'pending' | 'active' | 'paused' | 'ended'
export type TargetType = 'shop' | 'product'

const CHANNELS = new Set<PaidChannel>(['tiktok', 'meta', 'google', 'other'])
const STATUSES = new Set<PromoStatus>(['pending', 'active', 'paused', 'ended'])
const TARGET_TYPES = new Set<TargetType>(['shop', 'product'])

export interface PromotionRecord {
  id: number
  shopId: string
  shopName: string | null
  channel: PaidChannel
  status: PromoStatus
  targetType: TargetType | null
  targetListingId: string | null
  targetProductTitle: string | null
  targetProductImage: string | null
  adminNote: string | null
  activatedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MetricPoint {
  date: string
  impressions: number
  clicks: number
  visits: number
  orders: number
  spend: number
  revenue: number
}

interface PromotionRow {
  id: string | number
  shop_id: string
  shop_name?: string | null
  channel: PaidChannel
  status: PromoStatus
  target_type?: TargetType | null
  target_listing_id?: string | null
  target_product_title?: string | null
  target_product_image?: string | null
  admin_note?: string | null
  activated_at?: string | null
  created_at: string
  updated_at: string
}

interface MetricRow {
  metric_date: string | Date
  impressions?: string | number
  clicks?: string | number
  visits?: string | number
  orders?: string | number
  spend?: string | number
  revenue?: string | number
}

function rowToPromotion(row: PromotionRow | undefined): PromotionRecord | null {
  if (!row) return null
  return {
    id: Number(row.id),
    shopId: row.shop_id,
    shopName: row.shop_name ?? null,
    channel: row.channel,
    status: row.status,
    targetType: row.target_type ?? null,
    targetListingId: row.target_listing_id ?? null,
    targetProductTitle: row.target_product_title ?? null,
    targetProductImage: row.target_product_image ?? null,
    adminNote: row.admin_note ?? null,
    activatedAt: row.activated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToMetric(row: MetricRow): MetricPoint {
  const date =
    row.metric_date instanceof Date
      ? row.metric_date.toISOString().slice(0, 10)
      : String(row.metric_date).slice(0, 10)
  return {
    date,
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    visits: Number(row.visits ?? 0),
    orders: Number(row.orders ?? 0),
    spend: Math.round(Number(row.spend ?? 0) * 100) / 100,
    revenue: Math.round(Number(row.revenue ?? 0) * 100) / 100,
  }
}

function sumMetrics(metrics: MetricPoint[]) {
  return metrics.reduce(
    (acc, m) => ({
      impressions: acc.impressions + m.impressions,
      clicks: acc.clicks + m.clicks,
      visits: acc.visits + m.visits,
      orders: acc.orders + m.orders,
      spend: Math.round((acc.spend + m.spend) * 100) / 100,
      revenue: Math.round((acc.revenue + m.revenue) * 100) / 100,
    }),
    { impressions: 0, clicks: 0, visits: 0, orders: 0, spend: 0, revenue: 0 },
  )
}

const PROMOTION_SELECT = `
  SELECT
    p.*,
    s.name AS shop_name,
    prod.product_name AS target_product_title,
    CASE
      WHEN jsonb_typeof(prod.main_images) = 'array' AND jsonb_array_length(prod.main_images) > 0
      THEN prod.main_images->>0
      ELSE NULL
    END AS target_product_image
  FROM shop_paid_promotions p
  LEFT JOIN shops s ON s.id = p.shop_id
  LEFT JOIN shop_products sp ON sp.id::text = p.target_listing_id AND sp.shop_id = p.shop_id
  LEFT JOIN products prod ON prod.product_id = sp.product_id
`

export async function getActivePromotionByShopId(shopId: string): Promise<PromotionRecord | null> {
  const pool = getPool()
  const res = await pool.query<PromotionRow>(
    `${PROMOTION_SELECT}
     WHERE p.shop_id = $1 AND p.status = 'active'
     ORDER BY p.activated_at DESC NULLS LAST, p.id DESC
     LIMIT 1`,
    [shopId],
  )
  return rowToPromotion(res.rows[0])
}

export async function getPromotionById(id: number): Promise<PromotionRecord | null> {
  const pool = getPool()
  const res = await pool.query<PromotionRow>(`${PROMOTION_SELECT} WHERE p.id = $1`, [id])
  return rowToPromotion(res.rows[0])
}

export async function listPromotions(opts: { status?: string } = {}): Promise<PromotionRecord[]> {
  const pool = getPool()
  const params: string[] = []
  let where = 'WHERE 1=1'
  if (opts.status && STATUSES.has(opts.status as PromoStatus)) {
    params.push(opts.status)
    where += ` AND p.status = $${params.length}`
  }
  const res = await pool.query<PromotionRow>(
    `${PROMOTION_SELECT}
     ${where}
     ORDER BY
       CASE p.status
         WHEN 'active' THEN 0
         WHEN 'pending' THEN 1
         WHEN 'paused' THEN 2
         ELSE 3
       END,
       p.updated_at DESC`,
    params,
  )
  return res.rows.map((row) => rowToPromotion(row)!).filter(Boolean)
}

export async function createPromotion(input: {
  shopId: string
  channel: PaidChannel
  status?: PromoStatus
  adminNote?: string | null
}): Promise<PromotionRecord | null> {
  if (!CHANNELS.has(input.channel)) throw new Error('invalid_channel')
  const nextStatus = input.status && STATUSES.has(input.status) ? input.status : 'active'
  const pool = getPool()
  const activatedAt = nextStatus === 'active' ? new Date() : null
  const res = await pool.query<{ id: string }>(
    `INSERT INTO shop_paid_promotions (shop_id, channel, status, admin_note, activated_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [input.shopId, input.channel, nextStatus, input.adminNote ?? null, activatedAt],
  )
  return getPromotionById(Number(res.rows[0]?.id))
}

export async function updatePromotion(
  id: number,
  patch: { channel?: PaidChannel; status?: PromoStatus; adminNote?: string | null },
): Promise<PromotionRecord | null> {
  const existing = await getPromotionById(id)
  if (!existing) return null
  const fields: string[] = []
  const params: unknown[] = []
  if (patch.channel !== undefined) {
    if (!CHANNELS.has(patch.channel)) throw new Error('invalid_channel')
    params.push(patch.channel)
    fields.push(`channel = $${params.length}`)
  }
  if (patch.status !== undefined) {
    if (!STATUSES.has(patch.status)) throw new Error('invalid_status')
    params.push(patch.status)
    fields.push(`status = $${params.length}`)
    if (patch.status === 'active' && !existing.activatedAt) {
      fields.push('activated_at = now()')
    }
  }
  if (patch.adminNote !== undefined) {
    params.push(patch.adminNote)
    fields.push(`admin_note = $${params.length}`)
  }
  if (fields.length === 0) return existing
  params.push(id)
  const pool = getPool()
  await pool.query(
    `UPDATE shop_paid_promotions
     SET ${fields.join(', ')}, updated_at = now()
     WHERE id = $${params.length}`,
    params,
  )
  return getPromotionById(id)
}

export async function setPromotionTarget(
  id: number,
  input: { targetType: TargetType; targetListingId?: string },
): Promise<PromotionRecord | null> {
  if (!TARGET_TYPES.has(input.targetType)) throw new Error('invalid_target_type')
  const existing = await getPromotionById(id)
  if (!existing) return null
  if (existing.status !== 'active') throw new Error('promotion_not_active')
  const pool = getPool()
  if (input.targetType === 'product') {
    const listingId = typeof input.targetListingId === 'string' ? input.targetListingId.trim() : ''
    if (!listingId) throw new Error('listing_required')
    const check = await pool.query(
      `SELECT id FROM shop_products
       WHERE shop_id = $1 AND id::text = $2 AND status = 'on'`,
      [existing.shopId, listingId],
    )
    if (check.rows.length === 0) throw new Error('listing_not_found')
    await pool.query(
      `UPDATE shop_paid_promotions
       SET target_type = 'product', target_listing_id = $1, updated_at = now()
       WHERE id = $2`,
      [listingId, id],
    )
  } else {
    await pool.query(
      `UPDATE shop_paid_promotions
       SET target_type = 'shop', target_listing_id = NULL, updated_at = now()
       WHERE id = $1`,
      [id],
    )
  }
  return getPromotionById(id)
}

export async function getPromotionMetrics(promotionId: number, days = 7) {
  const pool = getPool()
  const res = await pool.query<MetricRow>(
    `SELECT metric_date, impressions, clicks, visits, orders, spend, revenue
     FROM shop_paid_promotion_metrics
     WHERE promotion_id = $1
       AND metric_date >= CURRENT_DATE - ($2::int - 1)
     ORDER BY metric_date ASC`,
    [promotionId, days],
  )
  const map = new Map(res.rows.map((row) => [rowToMetric(row).date, rowToMetric(row)]))
  const today = new Date()
  const series: MetricPoint[] = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    series.push(
      map.get(key) ?? {
        date: key,
        impressions: 0,
        clicks: 0,
        visits: 0,
        orders: 0,
        spend: 0,
        revenue: 0,
      },
    )
  }
  return { series, totals: sumMetrics(series) }
}

export async function upsertPromotionMetrics(promotionId: number, metrics: Partial<MetricPoint>[]) {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const m of metrics) {
      const date = typeof m.date === 'string' ? m.date.slice(0, 10) : null
      if (!date) continue
      await client.query(
        `INSERT INTO shop_paid_promotion_metrics
         (promotion_id, metric_date, impressions, clicks, visits, orders, spend, revenue)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (promotion_id, metric_date) DO UPDATE SET
           impressions = EXCLUDED.impressions,
           clicks = EXCLUDED.clicks,
           visits = EXCLUDED.visits,
           orders = EXCLUDED.orders,
           spend = EXCLUDED.spend,
           revenue = EXCLUDED.revenue`,
        [
          promotionId,
          date,
          Math.max(0, Math.round(Number(m.impressions ?? 0))),
          Math.max(0, Math.round(Number(m.clicks ?? 0))),
          Math.max(0, Math.round(Number(m.visits ?? 0))),
          Math.max(0, Math.round(Number(m.orders ?? 0))),
          Math.max(0, Number(m.spend ?? 0)),
          Math.max(0, Number(m.revenue ?? 0)),
        ],
      )
    }
    await client.query(`UPDATE shop_paid_promotions SET updated_at = now() WHERE id = $1`, [promotionId])
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  return getPromotionMetrics(promotionId, 7)
}
