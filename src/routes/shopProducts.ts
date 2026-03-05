import { Router } from 'express'
import { getPool } from '../db.js'

export const shopProductsRouter = Router()
const pool = process.env.DB_DSN ? () => getPool() : null

/** 店铺上架商品：采购并上架后商城站才展示；
 *  售价由系统根据店铺等级和商品采购价自动计算，前端不能自定义。
 */
shopProductsRouter.post('/', async (req, res) => {
  const { shopId, productId } = req.body as { shopId?: string; productId?: string }
  if (!shopId || !productId) {
    res.status(400).json({ success: false, message: '缺少 shopId 或 productId' })
    return
  }
  if (!pool) {
    res.status(503).json({ success: false, message: '未配置数据库' })
    return
  }
  try {
    const client = await pool().connect()
    try {
      // 1. 查询店铺等级
      const shopRes = await client.query<{ level: number | null }>(
        'SELECT level FROM shops WHERE id = $1',
        [shopId],
      )
      const shopLevel = shopRes.rows[0]?.level ?? 1

      // 2. 查询商品采购价（商品仓 purchase_price），若为空则退回 selling_price
      const prodRes = await client.query<{ purchase_price: string | null; selling_price: string | null }>(
        'SELECT purchase_price, selling_price FROM products WHERE product_id = $1',
        [productId],
      )
      if (prodRes.rows.length === 0) {
        res.status(400).json({ success: false, message: '商品不存在' })
        return
      }
      const pr = prodRes.rows[0]
      const basePrice = pr.purchase_price != null ? Number(pr.purchase_price) : Number(pr.selling_price ?? 0)
      if (!Number.isFinite(basePrice) || basePrice < 0) {
        res.status(400).json({ success: false, message: '商品采购价异常，无法定价' })
        return
      }

      // 3. 按店铺等级计算利润率
      // 1=普通店铺：10%，2=银牌：15%，3=金牌：20%，4=钻石：25%
      const levelMargin: Record<number, number> = {
        1: 0.10,
        2: 0.15,
        3: 0.20,
        4: 0.25,
      }
      const marginRate = levelMargin[shopLevel] ?? levelMargin[1]
      const finalPrice = Math.round(basePrice * (1 + marginRate) * 100) / 100

      const r = await client.query(
        `INSERT INTO shop_products (shop_id, product_id, status, price) VALUES ($1, $2, 'on', $3)
         ON CONFLICT (shop_id, product_id) DO UPDATE SET status = 'on', listed_at = now(), price = EXCLUDED.price
         RETURNING id`,
        [shopId, productId, String(finalPrice)],
      )
      const row = r.rows[0]
      res.json({ success: true, message: '已上架', listingId: row?.id, price: finalPrice })
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('[shop-products POST]', e)
    res.status(500).json({ success: false, message: '上架失败' })
  }
})

/** 店铺下架或永久删除：DELETE /:shopId/:productId 为下架；加 ?permanent=1 为从表内物理删除 */
shopProductsRouter.delete('/:shopId/:productId', async (req, res) => {
  const { shopId, productId } = req.params
  const permanent = req.query.permanent === '1' || req.query.permanent === 'true'
  if (!pool) {
    res.status(503).json({ success: false, message: '未配置数据库' })
    return
  }
  try {
    const client = await pool().connect()
    try {
      if (permanent) {
        const r = await client.query(
          'DELETE FROM shop_products WHERE shop_id = $1 AND product_id = $2',
          [shopId, productId]
        )
        res.json({ success: true, deleted: r.rowCount })
      } else {
        const r = await client.query(
          'UPDATE shop_products SET status = $1 WHERE shop_id = $2 AND product_id = $3',
          ['off', shopId, productId]
        )
        res.json({ success: true, updated: r.rowCount })
      }
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('[shop-products DELETE]', e)
    res.status(500).json({ success: false, message: permanent ? '删除失败' : '操作失败' })
  }
})

/** 某店铺已上架商品列表 */
shopProductsRouter.get('/by-shop/:shopId', async (req, res) => {
  const { shopId } = req.params
  if (!pool) {
    res.json({ list: [] })
    return
  }
  try {
    const client = await pool().connect()
    try {
      const r = await client.query(
        `SELECT sp.id AS listing_id, sp.product_id, sp.status, sp.price AS listing_price, sp.listed_at,
                p.product_name, p.main_images, p.selling_price AS product_price, p.purchase_price AS supply_price,
                c.name_en AS category_name, sc.name_en AS sub_category_name,
                (sr.listing_id IS NOT NULL) AS recommended
         FROM shop_products sp
         JOIN products p ON p.product_id = sp.product_id
         LEFT JOIN categories c ON c.category_id = p.category_id
         LEFT JOIN categories sc ON sc.category_id = p.sub_category_id
         LEFT JOIN shop_recommendations sr ON sr.shop_id = sp.shop_id AND sr.listing_id = sp.id::text
         WHERE sp.shop_id = $1
         ORDER BY sp.listed_at DESC`,
        [shopId]
      )
      const list = r.rows.map((row: Record<string, unknown>) => {
        const listingPrice = row.listing_price != null ? Number(row.listing_price) : null
        const productPrice = Number(row.product_price) || 0
        const mainImages = row.main_images
        const images = Array.isArray(mainImages)
          ? (mainImages as unknown[]).filter((src) => typeof src === 'string' && src).map((s) => String(s))
          : []
        const image = images[0] ?? ''
        return {
          listingId: row.listing_id,
          productId: row.product_id,
          status: row.status,
          listedAt: row.listed_at,
          title: row.product_name,
          image,
          images: images.length > 0 ? images : undefined,
          price: listingPrice != null ? listingPrice : productPrice,
          supplyPrice: row.supply_price != null ? Number(row.supply_price) : null,
          category: row.category_name ?? row.category_id,
          subCategory: row.sub_category_name ?? row.sub_category_id,
          recommended: Boolean(row.recommended),
        }
      })
      res.json({ list })
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('[shop-products by-shop]', e)
    res.status(500).json({ success: false, message: '查询失败' })
  }
})
