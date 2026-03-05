import { getPool } from '../db.ts'

/** 商品收藏 */
export async function addFavorite(params: {
  userId: string
  itemId: string
  title?: string
  image?: string
  price?: string
  subtitle?: string
  shopId?: string
}): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO user_product_favorites (user_id, item_id, title, image, price, subtitle, shop_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, item_id) DO UPDATE SET title = EXCLUDED.title, image = EXCLUDED.image, price = EXCLUDED.price, subtitle = EXCLUDED.subtitle, shop_id = EXCLUDED.shop_id`,
    [
      params.userId,
      params.itemId,
      params.title ?? null,
      params.image ?? null,
      params.price ?? null,
      params.subtitle ?? null,
      params.shopId ?? null,
    ]
  )
}

export async function removeFavorite(userId: string, itemId: string): Promise<boolean> {
  const pool = getPool()
  const res = await pool.query(
    'DELETE FROM user_product_favorites WHERE user_id = $1 AND item_id = $2',
    [userId, itemId]
  )
  return (res.rowCount ?? 0) > 0
}

export async function listFavorites(userId: string): Promise<
  Array<{ itemId: string; title: string | null; image: string | null; price: string | null; subtitle: string | null; shopId: string | null; createdAt: string }>
> {
  const pool = getPool()
  const res = await pool.query<{ item_id: string; title: string | null; image: string | null; price: string | null; subtitle: string | null; shop_id: string | null; created_at: string }>(
    'SELECT item_id, title, image, price, subtitle, shop_id, created_at FROM user_product_favorites WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  )
  return res.rows.map((r) => ({
    itemId: r.item_id,
    title: r.title,
    image: r.image,
    price: r.price,
    subtitle: r.subtitle,
    shopId: r.shop_id,
    createdAt: r.created_at,
  }))
}

export async function isFavorited(userId: string, itemId: string): Promise<boolean> {
  const pool = getPool()
  const res = await pool.query<{ n: string }>(
    'SELECT 1 AS n FROM user_product_favorites WHERE user_id = $1 AND item_id = $2 LIMIT 1',
    [userId, itemId]
  )
  return res.rows.length > 0
}

/** 关注店铺：写入关联表，并令店铺表 followers +1（仅当本次为新关注时） */
export async function addFollowedShop(params: { userId: string; shopId: string; shopName?: string }): Promise<void> {
  const pool = getPool()
  const existed = await pool.query<{ n: number }>(
    'SELECT 1 AS n FROM user_followed_shops WHERE user_id = $1 AND shop_id = $2 LIMIT 1',
    [params.userId, params.shopId]
  )
  const isNew = existed.rows.length === 0
  await pool.query(
    `INSERT INTO user_followed_shops (user_id, shop_id, shop_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, shop_id) DO UPDATE SET shop_name = COALESCE(EXCLUDED.shop_name, user_followed_shops.shop_name)`,
    [params.userId, params.shopId, params.shopName ?? null]
  )
  if (isNew) {
    await pool.query('UPDATE shops SET followers = COALESCE(followers, 0) + 1 WHERE id = $1', [params.shopId])
  }
}

/** 取消关注：删除关联并令店铺表 followers -1（不低于 0） */
export async function removeFollowedShop(userId: string, shopId: string): Promise<boolean> {
  const pool = getPool()
  const res = await pool.query(
    'DELETE FROM user_followed_shops WHERE user_id = $1 AND shop_id = $2',
    [userId, shopId]
  )
  if ((res.rowCount ?? 0) > 0) {
    await pool.query(
      'UPDATE shops SET followers = GREATEST(0, COALESCE(followers, 0) - 1) WHERE id = $1',
      [shopId]
    )
  }
  return (res.rowCount ?? 0) > 0
}

export async function listFollowedShops(userId: string): Promise<
  Array<{ shopId: string; shopName: string | null; shopLogo: string | null; createdAt: string }>
> {
  const pool = getPool()
  const res = await pool.query<{ shop_id: string; shop_name: string | null; shop_logo: string | null; created_at: string }>(
    `SELECT u.shop_id, u.shop_name, s.logo AS shop_logo, u.created_at
     FROM user_followed_shops u
     LEFT JOIN shops s ON s.id = u.shop_id
     WHERE u.user_id = $1
     ORDER BY u.created_at DESC`,
    [userId]
  )
  return res.rows.map((r) => ({
    shopId: r.shop_id,
    shopName: r.shop_name,
    shopLogo: r.shop_logo ?? null,
    createdAt: r.created_at,
  }))
}

export async function isShopFollowed(userId: string, shopId: string): Promise<boolean> {
  const pool = getPool()
  const res = await pool.query<{ n: string }>(
    'SELECT 1 AS n FROM user_followed_shops WHERE user_id = $1 AND shop_id = $2 LIMIT 1',
    [userId, shopId]
  )
  return res.rows.length > 0
}
