import { Router } from 'express'
import { getPool } from '../db.js'

export const homeRouter = Router()

const PRODUCT_COLS = `sp.id AS listing_id, sp.shop_id, sp.product_id, sp.price AS listing_price, p.product_name, p.main_images, p.selling_price AS product_price`
const PRODUCT_JOIN = `FROM shop_products sp INNER JOIN products p ON p.product_id = sp.product_id AND sp.status = 'on'`

function toProductItem(row: Record<string, unknown>) {
  const listingPrice = row.listing_price != null ? Number(row.listing_price) : null
  const productPrice = Number(row.product_price) || 0
  const price = listingPrice != null ? listingPrice : productPrice
  const mainImages = row.main_images ?? []
  const image = Array.isArray(mainImages) && mainImages[0] ? String(mainImages[0]) : ''
  return {
    id: String(row.listing_id),
    shopId: String(row.shop_id ?? ''),
    productId: String(row.product_id ?? ''),
    image,
    price: String(price.toFixed(2)),
    title: String(row.product_name ?? ''),
    subtitle: '',
  }
}

/** 每日上架新品：随机从所有店铺已上架在售商品中取 */
homeRouter.get('/new-arrivals', async (_req, res) => {
  try {
    const pool = getPool()
    const r = await pool.query(
      `SELECT ${PRODUCT_COLS} ${PRODUCT_JOIN} ORDER BY RANDOM() LIMIT 24`
    )
    res.json(r.rows.map(toProductItem))
  } catch (e) {
    console.error('[home new-arrivals]', e)
    res.status(500).json([])
  }
})

/** 推荐产品：管理员设置的推荐商品 */
homeRouter.get('/featured-products', async (_req, res) => {
  try {
    const pool = getPool()
    const r = await pool.query(
      `SELECT ${PRODUCT_COLS}
       ${PRODUCT_JOIN}
       INNER JOIN mall_featured_products mfp ON mfp.shop_id = sp.shop_id AND mfp.listing_id = sp.id
       ORDER BY mfp.sort_order ASC, mfp.id ASC
       LIMIT 24`
    )
    res.json(r.rows.map(toProductItem))
  } catch (e) {
    console.error('[home featured-products]', e)
    res.status(500).json([])
  }
})

/** 推荐店铺 */
homeRouter.get('/featured-shops', async (_req, res) => {
  try {
    const pool = getPool()
    const r = await pool.query(
      `SELECT s.id, s.name, s.logo,
              COALESCE(sp.listed_count, 0) AS products,
              COALESCE(s.sales, 0) AS sales,
              COALESCE(s.good_rate, 0) AS good_rate
       FROM mall_featured_shops mfs
       INNER JOIN shops s ON s.id = mfs.shop_id AND s.status = 'normal'
       LEFT JOIN (SELECT shop_id, COUNT(*) AS listed_count FROM shop_products WHERE status = 'on' GROUP BY shop_id) sp ON sp.shop_id = s.id
       ORDER BY mfs.sort_order ASC, mfs.id ASC
       LIMIT 9`
    )
    res.json(
      r.rows.map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ''),
        name: String(row.name ?? ''),
        logo: row.logo != null ? String(row.logo) : null,
        products: Number(row.products ?? 0),
        sales: Number(row.sales ?? 0),
        goodRate: Number(row.good_rate ?? 0),
      }))
    )
  } catch (e) {
    console.error('[home featured-shops]', e)
    res.status(500).json([])
  }
})

/** 热销推荐 */
homeRouter.get('/hot-products', async (_req, res) => {
  try {
    const pool = getPool()
    const r = await pool.query(
      `SELECT ${PRODUCT_COLS}
       ${PRODUCT_JOIN}
       INNER JOIN mall_hot_products mhp ON mhp.shop_id = sp.shop_id AND mhp.listing_id = sp.id
       ORDER BY mhp.sort_order ASC, mhp.id ASC
       LIMIT 24`
    )
    res.json(r.rows.map(toProductItem))
  } catch (e) {
    console.error('[home hot-products]', e)
    res.status(500).json([])
  }
})
