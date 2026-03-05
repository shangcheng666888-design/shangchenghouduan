import { Router } from 'express'
import { getPool } from '../db.js'

export const listingsRouter = Router()
const pool = process.env.DB_DSN ? () => getPool() : null

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 按上架记录 ID 或商品 ID 查详情：id 为 UUID 时按 sp.id 查，否则按 sp.product_id 查（取一条在售） */
listingsRouter.get('/:id', async (req, res) => {
  const id = req.params.id
  if (!pool) {
    res.status(404).json({ success: false, message: '上架记录不存在' })
    return
  }
  try {
    const client = await pool().connect()
    try {
      const byListingId = UUID_REGEX.test(id)
      const r = await client.query(
        byListingId
          ? `SELECT sp.id AS listing_id, sp.shop_id, sp.product_id, sp.price AS listing_price, sp.listed_at, sp.status,
                p.product_name, p.main_images, p.selling_price AS product_price, p.description_html, p.detail_html,
                p.category_id, p.sub_category_id, c.name_en AS category_name, sc.name_en AS sub_category_name
             FROM shop_products sp
             JOIN products p ON p.product_id = sp.product_id
             LEFT JOIN categories c ON c.category_id = p.category_id
             LEFT JOIN categories sc ON sc.category_id = p.sub_category_id
             WHERE sp.id = $1::uuid AND sp.status = 'on'`
          : `SELECT sp.id AS listing_id, sp.shop_id, sp.product_id, sp.price AS listing_price, sp.listed_at, sp.status,
                p.product_name, p.main_images, p.selling_price AS product_price, p.description_html, p.detail_html,
                p.category_id, p.sub_category_id, c.name_en AS category_name, sc.name_en AS sub_category_name
             FROM shop_products sp
             JOIN products p ON p.product_id = sp.product_id
             LEFT JOIN categories c ON c.category_id = p.category_id
             LEFT JOIN categories sc ON sc.category_id = p.sub_category_id
             WHERE sp.product_id = $1 AND sp.status = 'on'
             ORDER BY sp.listed_at DESC
             LIMIT 1`,
        [id]
      )
      const row = r.rows[0]
      if (!row) {
        res.status(404).json({ success: false, message: '上架记录不存在或已下架' })
        return
      }
      const listingPrice = row.listing_price != null ? Number(row.listing_price) : null
      const productPrice = Number(row.product_price) || 0
      const price = listingPrice != null ? listingPrice : productPrice
      const mainImages = row.main_images ?? []
      const skuRes = await client.query(
        'SELECT sku_id, product_id, attrs, purchase_price, selling_price, cover_img, images FROM product_skus WHERE product_id = $1 LIMIT 50',
        [row.product_id]
      )
      res.json({
        id: row.listing_id,
        listingId: row.listing_id,
        shopId: row.shop_id,
        productId: row.product_id,
        title: row.product_name,
        image: Array.isArray(mainImages) && mainImages[0] ? mainImages[0] : '',
        images: mainImages,
        price,
        purchasePrice: productPrice,
        category: row.category_name ?? row.category_id,
        subCategory: row.sub_category_name ?? row.sub_category_id,
        descriptionHtml: row.description_html,
        detailHtml: row.detail_html,
        listedAt: row.listed_at,
        skus: skuRes.rows,
      })
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('[listings/:id]', e)
    res.status(500).json({ success: false, message: '查询失败' })
  }
})
