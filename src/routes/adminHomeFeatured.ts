import { Router, type Request } from 'express'
import { getPool } from '../db.js'

export const adminHomeFeaturedRouter = Router()

const FEATURED_PRODUCTS_MAX = 24
const FEATURED_SHOPS_MAX = 9
const HOT_PRODUCTS_MAX = 24

/** 推荐产品：列表（含图片、价格用于卡片展示） */
adminHomeFeaturedRouter.get('/featured-products', async (_req, res) => {
  try {
    const pool = getPool()
    const r = await pool.query(
      `SELECT mfp.id, mfp.shop_id, mfp.listing_id, mfp.sort_order,
              s.name AS shop_name, p.product_name, p.main_images, sp.price AS listing_price, p.selling_price
       FROM mall_featured_products mfp
       JOIN shops s ON s.id = mfp.shop_id
       JOIN shop_products sp ON sp.shop_id = mfp.shop_id AND sp.id = mfp.listing_id AND sp.status = 'on'
       JOIN products p ON p.product_id = sp.product_id
       ORDER BY mfp.sort_order ASC, mfp.id ASC`
    )
    res.json(
      r.rows.map((row: Record<string, unknown>) => {
        const imgs = row.main_images ?? []
        const image = Array.isArray(imgs) && imgs[0] ? String(imgs[0]) : ''
        const price = row.listing_price != null ? Number(row.listing_price) : Number(row.selling_price ?? 0)
        return {
          id: row.id,
          shopId: String(row.shop_id ?? ''),
          listingId: String(row.listing_id ?? ''),
          sortOrder: Number(row.sort_order ?? 0),
          shopName: String(row.shop_name ?? ''),
          productTitle: String(row.product_name ?? ''),
          image,
          price: price.toFixed(2),
        }
      })
    )
  } catch (e) {
    console.error('[admin home-featured featured-products get]', e)
    res.status(500).json({ message: '获取失败' })
  }
})

/** 推荐产品：添加（最多 24 个） */
adminHomeFeaturedRouter.post('/featured-products', async (req: Request, res) => {
  try {
    const body = req.body as { shopId?: string; listingId?: string }
    const shopId = typeof body.shopId === 'string' ? body.shopId.trim() : ''
    const listingId = typeof body.listingId === 'string' ? body.listingId.trim() : ''
    if (!shopId || !listingId) {
      res.status(400).json({ message: '请选择店铺与商品' })
      return
    }
    const pool = getPool()
    const countRes = await pool.query('SELECT COUNT(*) AS c FROM mall_featured_products')
    if (Number(countRes.rows[0]?.c ?? 0) >= FEATURED_PRODUCTS_MAX) {
      res.status(400).json({ message: `推荐产品最多 ${FEATURED_PRODUCTS_MAX} 个` })
      return
    }
    await pool.query(
      `INSERT INTO mall_featured_products (shop_id, listing_id, sort_order)
       SELECT $1, $2::uuid, COALESCE((SELECT MAX(sort_order) + 1 FROM mall_featured_products), 0)
       WHERE EXISTS (SELECT 1 FROM shop_products WHERE shop_id = $1 AND id = $2::uuid AND status = 'on')
       ON CONFLICT (shop_id, listing_id) DO NOTHING`,
      [shopId, listingId]
    )
    const r = await pool.query('SELECT id FROM mall_featured_products WHERE shop_id = $1 AND listing_id = $2::uuid', [
      shopId,
      listingId,
    ])
    if (r.rows.length === 0) {
      res.status(400).json({ message: '该商品不存在或未上架' })
      return
    }
    res.json({ success: true, id: r.rows[0].id })
  } catch (e) {
    console.error('[admin home-featured featured-products post]', e)
    res.status(500).json({ message: '添加失败' })
  }
})

/** 推荐产品：删除 */
adminHomeFeaturedRouter.delete('/featured-products/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ message: '无效 id' })
      return
    }
    const pool = getPool()
    await pool.query('DELETE FROM mall_featured_products WHERE id = $1', [id])
    res.json({ success: true })
  } catch (e) {
    console.error('[admin home-featured featured-products delete]', e)
    res.status(500).json({ message: '删除失败' })
  }
})

/** 推荐店铺：列表 */
adminHomeFeaturedRouter.get('/featured-shops', async (_req, res) => {
  try {
    const pool = getPool()
    const r = await pool.query(
      `SELECT mfs.id, mfs.shop_id, mfs.sort_order, s.name AS shop_name, s.logo
       FROM mall_featured_shops mfs
       JOIN shops s ON s.id = mfs.shop_id
       ORDER BY mfs.sort_order ASC, mfs.id ASC`
    )
    res.json(
      r.rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        shopId: String(row.shop_id ?? ''),
        sortOrder: Number(row.sort_order ?? 0),
        shopName: String(row.shop_name ?? ''),
        logo: row.logo != null ? String(row.logo) : null,
      }))
    )
  } catch (e) {
    console.error('[admin home-featured featured-shops get]', e)
    res.status(500).json({ message: '获取失败' })
  }
})

/** 推荐店铺：添加（最多 9 个） */
adminHomeFeaturedRouter.post('/featured-shops', async (req: Request, res) => {
  try {
    const body = req.body as { shopId?: string }
    const shopId = typeof body.shopId === 'string' ? body.shopId.trim() : ''
    if (!shopId) {
      res.status(400).json({ message: '请选择店铺' })
      return
    }
    const pool = getPool()
    const countRes = await pool.query('SELECT COUNT(*) AS c FROM mall_featured_shops')
    if (Number(countRes.rows[0]?.c ?? 0) >= FEATURED_SHOPS_MAX) {
      res.status(400).json({ message: `推荐店铺最多 ${FEATURED_SHOPS_MAX} 个` })
      return
    }
    await pool.query(
      `INSERT INTO mall_featured_shops (shop_id, sort_order)
       SELECT $1, COALESCE((SELECT MAX(sort_order) + 1 FROM mall_featured_shops), 0)
       WHERE EXISTS (SELECT 1 FROM shops WHERE id = $1)
       ON CONFLICT (shop_id) DO NOTHING`,
      [shopId]
    )
    const r = await pool.query('SELECT id FROM mall_featured_shops WHERE shop_id = $1', [shopId])
    if (r.rows.length === 0) {
      res.status(400).json({ message: '店铺不存在或已推荐' })
      return
    }
    res.json({ success: true, id: r.rows[0].id })
  } catch (e) {
    console.error('[admin home-featured featured-shops post]', e)
    res.status(500).json({ message: '添加失败' })
  }
})

/** 推荐店铺：删除 */
adminHomeFeaturedRouter.delete('/featured-shops/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ message: '无效 id' })
      return
    }
    const pool = getPool()
    await pool.query('DELETE FROM mall_featured_shops WHERE id = $1', [id])
    res.json({ success: true })
  } catch (e) {
    console.error('[admin home-featured featured-shops delete]', e)
    res.status(500).json({ message: '删除失败' })
  }
})

/** 热销推荐：列表（含图片、价格用于卡片展示） */
adminHomeFeaturedRouter.get('/hot-products', async (_req, res) => {
  try {
    const pool = getPool()
    const r = await pool.query(
      `SELECT mhp.id, mhp.shop_id, mhp.listing_id, mhp.sort_order,
              s.name AS shop_name, p.product_name, p.main_images, sp.price AS listing_price, p.selling_price
       FROM mall_hot_products mhp
       JOIN shops s ON s.id = mhp.shop_id
       JOIN shop_products sp ON sp.shop_id = mhp.shop_id AND sp.id = mhp.listing_id AND sp.status = 'on'
       JOIN products p ON p.product_id = sp.product_id
       ORDER BY mhp.sort_order ASC, mhp.id ASC`
    )
    res.json(
      r.rows.map((row: Record<string, unknown>) => {
        const imgs = row.main_images ?? []
        const image = Array.isArray(imgs) && imgs[0] ? String(imgs[0]) : ''
        const price = row.listing_price != null ? Number(row.listing_price) : Number(row.selling_price ?? 0)
        return {
          id: row.id,
          shopId: String(row.shop_id ?? ''),
          listingId: String(row.listing_id ?? ''),
          sortOrder: Number(row.sort_order ?? 0),
          shopName: String(row.shop_name ?? ''),
          productTitle: String(row.product_name ?? ''),
          image,
          price: price.toFixed(2),
        }
      })
    )
  } catch (e) {
    console.error('[admin home-featured hot-products get]', e)
    res.status(500).json({ message: '获取失败' })
  }
})

/** 热销推荐：添加（最多 24 个） */
adminHomeFeaturedRouter.post('/hot-products', async (req: Request, res) => {
  try {
    const body = req.body as { shopId?: string; listingId?: string }
    const shopId = typeof body.shopId === 'string' ? body.shopId.trim() : ''
    const listingId = typeof body.listingId === 'string' ? body.listingId.trim() : ''
    if (!shopId || !listingId) {
      res.status(400).json({ message: '请选择店铺与商品' })
      return
    }
    const pool = getPool()
    const countRes = await pool.query('SELECT COUNT(*) AS c FROM mall_hot_products')
    if (Number(countRes.rows[0]?.c ?? 0) >= HOT_PRODUCTS_MAX) {
      res.status(400).json({ message: `热销推荐最多 ${HOT_PRODUCTS_MAX} 个` })
      return
    }
    await pool.query(
      `INSERT INTO mall_hot_products (shop_id, listing_id, sort_order)
       SELECT $1, $2::uuid, COALESCE((SELECT MAX(sort_order) + 1 FROM mall_hot_products), 0)
       WHERE EXISTS (SELECT 1 FROM shop_products WHERE shop_id = $1 AND id = $2::uuid AND status = 'on')
       ON CONFLICT (shop_id, listing_id) DO NOTHING`,
      [shopId, listingId]
    )
    const r = await pool.query('SELECT id FROM mall_hot_products WHERE shop_id = $1 AND listing_id = $2::uuid', [
      shopId,
      listingId,
    ])
    if (r.rows.length === 0) {
      res.status(400).json({ message: '该商品不存在或未上架' })
      return
    }
    res.json({ success: true, id: r.rows[0].id })
  } catch (e) {
    console.error('[admin home-featured hot-products post]', e)
    res.status(500).json({ message: '添加失败' })
  }
})

/** 热销推荐：删除 */
adminHomeFeaturedRouter.delete('/hot-products/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ message: '无效 id' })
      return
    }
    const pool = getPool()
    await pool.query('DELETE FROM mall_hot_products WHERE id = $1', [id])
    res.json({ success: true })
  } catch (e) {
    console.error('[admin home-featured hot-products delete]', e)
    res.status(500).json({ message: '删除失败' })
  }
})
