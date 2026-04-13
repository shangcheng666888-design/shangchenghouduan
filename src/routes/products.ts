import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { getPool } from '../db.js'
import { store } from '../store.js'

export const productsRouter = Router()

const pool = process.env.DB_DSN ? () => getPool() : null

const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? ''
const BUCKET_COMMODITY = process.env.BUCKET_COMMODITY ?? 'commodity'
const CAN_DELETE_COMMODITY =
  !!SUPABASE_URL && !!SUPABASE_KEY && !!BUCKET_COMMODITY && BUCKET_COMMODITY.length > 0

const supabaseForCommodity = CAN_DELETE_COMMODITY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null

const extractCommodityPath = (url: unknown): string | null => {
  if (!url || typeof url !== 'string') return null
  // Supabase 公网访问前缀示例：
  // https://PROJECT.supabase.co/storage/v1/object/public/commodity/path/to/file.jpg
  const marker = `/storage/v1/object/public/${BUCKET_COMMODITY}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return url.slice(idx + marker.length)
}

const diffCommodityPaths = (oldUrls: unknown[], newUrls: unknown[]): string[] => {
  const oldSet = new Set<string>()
  const newSet = new Set<string>()
  for (const u of oldUrls) {
    const p = extractCommodityPath(u)
    if (p) oldSet.add(p)
  }
  for (const u of newUrls) {
    const p = extractCommodityPath(u)
    if (p) newSet.add(p)
  }
  const toDelete: string[] = []
  for (const p of oldSet) {
    if (!newSet.has(p)) toDelete.push(p)
  }
  return toDelete
}

const deleteCommodityObjects = async (paths: string[]): Promise<void> => {
  if (!supabaseForCommodity || paths.length === 0) return
  try {
    const { error } = await supabaseForCommodity.storage
      .from(BUCKET_COMMODITY)
      .remove(paths)
    if (error) {
      console.error('[products commodity image delete]', error)
    }
  } catch (e) {
    console.error('[products commodity image delete] unexpected error', e)
  }
}

/** 供货列表：分页、分类、搜索。字段来自 products + categories.name_en；价格用 products.purchase_price/selling_price 与 product_skus.purchase_price；不使用 product_i18n。须在 GET /:id 之前注册 */
productsRouter.get('/supply', async (req, res) => {
  const categoryId = req.query.categoryId as string | undefined
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const offset = Math.max(0, Number(req.query.offset) || 0)
  if (!pool) {
    res.status(503).json({ success: false, message: '数据库未配置' })
    return
  }
  try {
    const client = await pool().connect()
    try {
      const joinCat = `FROM products p
             LEFT JOIN categories c ON c.category_id = p.category_id
             LEFT JOIN categories sc ON sc.category_id = p.sub_category_id`
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
      const hasSearch = search.length > 0
      const whereParts: string[] = []
      const countParams: unknown[] = []
      const listParams: unknown[] = []
      // 采购列表返回所有商品（含已停止供货）；前端根据 supply_status 显示卡片阴影 +「暂无库存」，不可采购
      if (categoryId) {
        whereParts.push(`(p.category_id = $${whereParts.length + 1} OR p.sub_category_id = $${whereParts.length + 1})`)
        countParams.push(categoryId)
        listParams.push(categoryId)
      }
      if (hasSearch) {
        whereParts.push(`(p.product_name ILIKE $${whereParts.length + 1} OR p.product_id::text ILIKE $${whereParts.length + 1})`)
        countParams.push(`%${search}%`)
        listParams.push(`%${search}%`)
      }
      const where = whereParts.length > 0 ? ' WHERE ' + whereParts.join(' AND ') : ''
      listParams.push(limit, offset)
      const r = await client.query(
        `SELECT p.product_id, p.product_name, p.main_images,
                p.purchase_price, p.selling_price,
                p.category_id, p.sub_category_id, COALESCE(p.supply_status, 'on') AS supply_status,
                c.name_en AS category_name, sc.name_en AS sub_category_name,
                (SELECT MIN(ps.purchase_price) FROM product_skus ps WHERE ps.product_id = p.product_id AND ps.purchase_price IS NOT NULL) AS sku_min_purchase_price
         ${joinCat} ${where}
         ORDER BY p.product_id LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      )
      const list = r.rows.map((row: Record<string, unknown>) => {
        const productPurchase = row.purchase_price != null ? Number(row.purchase_price) : null
        const skuFallback = row.sku_min_purchase_price != null ? Number(row.sku_min_purchase_price) : null
        const purchasePrice = productPurchase ?? skuFallback
        const mainImages = row.main_images
        const image = Array.isArray(mainImages) && mainImages[0] ? String(mainImages[0]) : ''
        const images = Array.isArray(mainImages)
          ? (mainImages as unknown[]).filter((src) => typeof src === 'string' && src).map((src) => String(src))
          : image
          ? [image]
          : []
        return {
          id: String(row.product_id ?? ''),
          title: String(row.product_name ?? ''),
          image,
          images,
          status: String(row.supply_status ?? 'on'),
          purchasePrice,
          price: Number(row.selling_price) || 0,
          category: String(row.category_name ?? row.category_id ?? ''),
          subCategory: String(row.sub_category_name ?? row.sub_category_id ?? ''),
          sales: 0,
        }
      })
      const countRes = await client.query(
        `SELECT COUNT(*) AS c FROM products p ${where}`,
        countParams
      )
      const total = Number(countRes.rows[0]?.c ?? 0)
      res.json({ list, total, limit, offset })
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('[products/supply] db error', e)
    res.status(500).json({ success: false, message: '数据库查询失败' })
  }
})

/** 供货单商品详情：只按 product_id 查，单条 SQL；入参 trim；无 supply_status；SKU 为空返回 []。COALESCE 统一用 jsonb 避免库中 json/jsonb 混用报错 */
const SQL_SUPPLY_DETAIL = `
SELECT json_build_object(
  'id', p.product_id,
  'goodsId', p.goods_id,
  'title', p.product_name,
  'image', COALESCE(p.main_images->>0, ''),
  'images', COALESCE(p.main_images::jsonb, '[]'::jsonb),
  'purchasePrice', p.purchase_price,
  'price', p.selling_price,
           'categoryId', p.category_id,
           'subCategoryId', p.sub_category_id,
           'status', COALESCE(p.supply_status, 'on'),
  'category', c.name_en,
  'subCategory', sc.name_en,
  'descriptionHtml', COALESCE(p.description_html, ''),
  'detailHtml', COALESCE(p.detail_html, ''),
  'skus', (
    SELECT COALESCE(json_agg(json_build_object(
      'skuId', sku_id,
      'attrs', attrs,
      'purchasePrice', purchase_price,
      'sellingPrice', selling_price,
      'coverImg', cover_img,
      'images', images
    ))::jsonb, '[]'::jsonb)
    FROM product_skus ps
    WHERE ps.product_id = p.product_id
  )
) AS item
FROM products p
LEFT JOIN categories c  ON c.category_id  = p.category_id
LEFT JOIN categories sc ON sc.category_id = p.sub_category_id
WHERE p.product_id = $1
LIMIT 1
`
productsRouter.get('/supply/:productId', async (req, res) => {
  const productId = (req.params.productId ?? '').trim()
  if (!productId) {
    res.status(400).json({ success: false, message: '缺少商品 ID' })
    return
  }
  if (!pool) {
    res.status(503).json({ success: false, message: '数据库未配置' })
    return
  }
  try {
    const client = await pool().connect()
    try {
      const r = await client.query(SQL_SUPPLY_DETAIL, [productId])
      const row = r.rows[0] as { item: Record<string, unknown> } | undefined
      if (!row?.item) {
        console.warn('[products/supply/:productId] 404 productId=', JSON.stringify(productId))
        res.status(404).json({ success: false, message: '未找到该商品', productId })
        return
      }
      res.json(row.item)
    } finally {
      client.release()
    }
  } catch (e) {
    const err = e as Error & { code?: string; detail?: string; routine?: string }
    const detail = err.message || err.detail || String(e)
    console.error('[products/supply/:productId] db error', detail)
    const isDev = process.env.NODE_ENV !== 'production'
    res.status(500).json({
      success: false,
      message: isDev ? `数据库查询失败: ${detail}` : '数据库查询失败',
      productId,
      ...(isDev && { error: detail }),
    })
  }
})

/** 新增供货商品：插入 products 与 product_skus，返回新 product_id */
productsRouter.post('/supply', async (req, res) => {
  const body = req.body as {
    title?: string
    descriptionHtml?: string | null
    detailHtml?: string | null
    images?: string[]
    purchasePrice?: number | null
    price?: number | null
    categoryId?: string | null
    subCategoryId?: string | null
    skus?: Array<Record<string, unknown>>
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) {
    res.status(400).json({ success: false, message: '缺少商品名称' })
    return
  }
  if (!pool) {
    res.status(503).json({ success: false, message: '数据库未配置' })
    return
  }
  try {
    const client = await pool().connect()
    try {
      await client.query('BEGIN')
      const productId = String(Date.now())
      const mainImages = Array.isArray(body.images) ? body.images : []
      const descriptionHtml =
        body.descriptionHtml == null || body.descriptionHtml === '' ? null : String(body.descriptionHtml)
      const detailHtml =
        body.detailHtml == null || body.detailHtml === '' ? null : String(body.detailHtml)
      const purchasePrice =
        typeof body.purchasePrice === 'number' ? body.purchasePrice : null
      const price =
        typeof body.price === 'number' ? body.price : null
      const categoryId = body.categoryId ?? null
      const subCategoryId = body.subCategoryId ?? null

      await client.query(
        `INSERT INTO products (product_id, product_name, description_html, detail_html, main_images, purchase_price, selling_price, category_id, sub_category_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          productId,
          title,
          descriptionHtml,
          detailHtml,
          JSON.stringify(mainImages),
          purchasePrice,
          price,
          categoryId,
          subCategoryId,
        ]
      )

      const skus = Array.isArray(body.skus) ? body.skus : []
      for (let i = 0; i < skus.length; i++) {
        const s = skus[i]
        const attrs =
          s?.attrs != null
            ? (typeof s.attrs === 'object' ? JSON.stringify(s.attrs) : String(s.attrs))
            : null
        const skuPurchasePrice =
          typeof s?.purchasePrice === 'number' ? s.purchasePrice : null
        const skuSellingPrice =
          typeof s?.sellingPrice === 'number' ? s.sellingPrice : null
        const coverImg = s?.coverImg != null ? String(s.coverImg) : null
        const images =
          s?.images != null
            ? (Array.isArray(s.images) ? JSON.stringify(s.images) : null)
            : null
        await client.query(
          `INSERT INTO product_skus (product_id, attrs, purchase_price, selling_price, cover_img, images)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [productId, attrs, skuPurchasePrice, skuSellingPrice, coverImg, images]
        )
      }

      await client.query('COMMIT')
      res.json({ success: true, id: productId })
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('[products POST /supply] db error', e)
    res.status(500).json({ success: false, message: '创建失败' })
  }
})

/** 更新供货商品：名称、描述、主图、供货价、建议售价等 */
productsRouter.patch('/supply/:productId', async (req, res) => {
  const productId = req.params.productId
  const body = req.body as Record<string, unknown>
  if (!pool) {
    res.status(503).json({ success: false, message: '数据库未配置' })
    return
  }
  try {
    const client = await pool().connect()
    try {
      let oldMainImages: unknown[] | null = null
      if (CAN_DELETE_COMMODITY && Array.isArray(body.images)) {
        const exist = await client.query<{ main_images: unknown }>(
          'SELECT main_images FROM products WHERE product_id = $1',
          [productId]
        )
        const row = exist.rows[0]
        if (row && Array.isArray((row as unknown as { main_images: unknown }).main_images)) {
          oldMainImages = (row as unknown as { main_images: unknown[] }).main_images
        }
      }

      const updates: string[] = []
      const params: unknown[] = []
      let idx = 1
      if (typeof body.title === 'string') {
        updates.push(`product_name = $${idx++}`)
        params.push(body.title)
      }
      if (body.descriptionHtml !== undefined) {
        updates.push(`description_html = $${idx++}`)
        params.push(body.descriptionHtml === null || body.descriptionHtml === '' ? null : String(body.descriptionHtml))
      }
      if (body.detailHtml !== undefined) {
        updates.push(`detail_html = $${idx++}`)
        params.push(body.detailHtml === null || body.detailHtml === '' ? null : String(body.detailHtml))
      }
      if (Array.isArray(body.images)) {
        updates.push(`main_images = $${idx++}`)
        params.push(JSON.stringify(body.images))
      }
      if (typeof body.purchasePrice === 'number') {
        updates.push(`purchase_price = $${idx++}`)
        params.push(body.purchasePrice)
      }
      if (typeof body.price === 'number') {
        updates.push(`selling_price = $${idx++}`)
        params.push(body.price)
      }
      if (updates.length === 0) {
        res.json({ success: true })
        return
      }
      params.push(productId)
      await client.query(
        `UPDATE products SET ${updates.join(', ')} WHERE product_id = $${idx}`,
        params
      )
      if (CAN_DELETE_COMMODITY && oldMainImages && Array.isArray(body.images)) {
        const toDelete = diffCommodityPaths(oldMainImages, body.images as unknown[])
        if (toDelete.length > 0) {
          await deleteCommodityObjects(toDelete)
        }
      }
      res.json({ success: true })
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('[products PATCH supply/:productId] db error', e)
    res.status(500).json({ success: false, message: '更新失败' })
  }
})

/** 上架/下架：依赖 products.supply_status 列（on/off） */
productsRouter.patch('/supply/:productId/status', async (req, res) => {
  const productId = (req.params.productId ?? '').trim()
  const body = req.body as { status?: string }
  const status = body.status === 'on' || body.status === 'off' ? body.status : null
  if (!productId || !status) {
    res.status(400).json({ success: false, message: '缺少商品 ID 或状态' })
    return
  }
  if (!pool) {
    res.status(503).json({ success: false, message: '数据库未配置' })
    return
  }
  try {
    const client = await pool().connect()
    try {
      const r = await client.query(
        'UPDATE products SET supply_status = $1 WHERE product_id = $2',
        [status, productId]
      )
      if (r.rowCount === 0) {
        res.status(404).json({ success: false, message: '商品不存在' })
        return
      }
      res.json({ success: true })
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('[products PATCH supply/:productId/status] db error', e)
    res.status(500).json({ success: false, message: '更新失败' })
  }
})

/** 覆盖该供货商品下全部 SKU（款式）。事务：DELETE 该 product_id 下全部 SKU，再按 body.skus 逐条 INSERT；skus 为空数组则只删不插。body { skus: Array<{ attrs?, purchasePrice?, sellingPrice?, coverImg?, images? }> } */
productsRouter.put('/supply/:productId/skus', async (req, res) => {
  const productId = req.params.productId
  const body = req.body as { skus?: Array<Record<string, unknown>> }
  const skus = Array.isArray(body.skus) ? body.skus : []
  if (!pool) {
    res.status(503).json({ success: false, message: '数据库未配置' })
    return
  }
  try {
    const client = await pool().connect()
    try {
      await client.query('BEGIN')
      let oldSkuUrls: unknown[] = []
      if (CAN_DELETE_COMMODITY) {
        const rOld = await client.query<{ cover_img: unknown; images: unknown }>(
          'SELECT cover_img, images FROM product_skus WHERE product_id = $1',
          [productId]
        )
        for (const row of rOld.rows) {
          if (row.cover_img) oldSkuUrls.push(row.cover_img)
          const imgs = row.images
          if (Array.isArray(imgs)) {
            oldSkuUrls = oldSkuUrls.concat(imgs)
          }
        }
      }
      const exist = await client.query('SELECT product_id FROM products WHERE product_id = $1', [productId])
      if (exist.rows.length === 0) {
        await client.query('ROLLBACK')
        res.status(404).json({ success: false, message: '商品不存在' })
        return
      }
      await client.query('DELETE FROM product_skus WHERE product_id = $1', [productId])
      for (let i = 0; i < skus.length; i++) {
        const s = skus[i]
        const attrs = s?.attrs != null ? (typeof s.attrs === 'object' ? JSON.stringify(s.attrs) : String(s.attrs)) : null
        const purchasePrice = typeof s?.purchasePrice === 'number' ? s.purchasePrice : null
        const sellingPrice = typeof s?.sellingPrice === 'number' ? s.sellingPrice : null
        const coverImg = s?.coverImg != null ? String(s.coverImg) : null
        const images = s?.images != null ? (Array.isArray(s.images) ? JSON.stringify(s.images) : null) : null
        await client.query(
          `INSERT INTO product_skus (product_id, attrs, purchase_price, selling_price, cover_img, images)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [productId, attrs, purchasePrice, sellingPrice, coverImg, images]
        )
      }
      await client.query('COMMIT')
      if (CAN_DELETE_COMMODITY && oldSkuUrls.length > 0) {
        const newSkuUrls: unknown[] = []
        for (const s of skus) {
          if (s?.coverImg != null) newSkuUrls.push(s.coverImg)
          if (Array.isArray(s?.images)) {
            newSkuUrls.push(...(s.images as unknown[]))
          }
        }
        const toDelete = diffCommodityPaths(oldSkuUrls, newSkuUrls)
        if (toDelete.length > 0) {
          await deleteCommodityObjects(toDelete)
        }
      }
      res.json({ success: true })
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('[products PUT supply/:productId/skus] db error', e)
    res.status(500).json({ success: false, message: '更新失败' })
  }
})

/** 商城站商品列表：仅返回已被店铺卖家采购并上架的商品（shop_products.status='on'），同一商品多店铺上架则返回多条。支持 categoryId、subCategoryId、search（商品名/商品ID 模糊） */
productsRouter.get('/', async (req, res) => {
  const category = req.query.category as string | undefined
  const categoryId = req.query.categoryId as string | undefined
  const subCategoryId = req.query.subCategoryId as string | undefined
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 20))
  const offset = Math.max(0, Number(req.query.offset) || 0)

  if (pool) {
    try {
      const client = await pool().connect()
      try {
        const joinListed = `FROM shop_products sp
             INNER JOIN products p ON p.product_id = sp.product_id AND sp.status = 'on'
             LEFT JOIN shops s ON s.id = sp.shop_id
             LEFT JOIN categories c ON c.category_id = p.category_id
             LEFT JOIN categories sc ON sc.category_id = p.sub_category_id`
        const selectCols = `SELECT sp.id AS listing_id, sp.shop_id, sp.product_id, sp.price AS listing_price, sp.listed_at,
                    p.product_name, p.main_images, p.selling_price AS product_price, p.category_id, p.sub_category_id,
                    c.name_en AS category_name, sc.name_en AS sub_category_name`
        const whereParts: string[] = []
        const filterParams: string[] = []
        if (subCategoryId && subCategoryId.trim()) {
          whereParts.push(`p.sub_category_id = $${filterParams.length + 1}`)
          filterParams.push(subCategoryId.trim())
        } else if (categoryId && categoryId.trim()) {
          whereParts.push(`p.category_id = $${filterParams.length + 1}`)
          filterParams.push(categoryId.trim())
        }
        if (search.length > 0) {
          whereParts.push(`(p.product_name ILIKE $${filterParams.length + 1} OR p.product_id::text ILIKE $${filterParams.length + 1} OR sp.shop_id ILIKE $${filterParams.length + 1} OR s.name ILIKE $${filterParams.length + 1})`)
          filterParams.push(`%${search}%`)
        }
        const where = whereParts.length > 0 ? ' WHERE ' + whereParts.join(' AND ') : ''
        const args = [...filterParams, limit, offset]
        const r = await client.query(
          `${selectCols} ${joinListed} ${where}
           ORDER BY sp.listed_at DESC LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
          args
        )
        const list = r.rows.map((row: Record<string, unknown>) => {
          const listingPrice = row.listing_price != null ? Number(row.listing_price) : null
          const productPrice = Number(row.product_price) || 0
          const price = listingPrice != null ? listingPrice : productPrice
          return {
            id: String(row.listing_id),
            listingId: String(row.listing_id),
            shopId: String(row.shop_id),
            productId: String(row.product_id),
            title: String(row.product_name ?? ''),
            image: Array.isArray(row.main_images) && row.main_images[0] ? String(row.main_images[0]) : '',
            price,
            category: String(row.category_name ?? row.category_id ?? ''),
            subCategory: String(row.sub_category_name ?? row.sub_category_id ?? ''),
            sales: 0,
          }
        })
        const countBase = `FROM shop_products sp INNER JOIN products p ON p.product_id = sp.product_id AND sp.status = 'on' LEFT JOIN shops s ON s.id = sp.shop_id`
        const countWhere = where
        const countRes = await client.query(
          `SELECT COUNT(*) AS c ${countBase}${countWhere}`,
          filterParams
        )
        const total = Number(countRes.rows[0]?.c ?? 0)
        res.json({ list, total, limit, offset })
        return
      } finally {
        client.release()
      }
    } catch (e) {
      console.error('[products] db error', e)
      res.status(500).json({ success: false, message: '数据库查询失败' })
      return
    }
  }

  let list = [...store.products.values()]
  if (category) list = list.filter((p) => p.category === category)
  list = list.slice(offset, offset + limit)
  res.json({ list, total: store.products.size, limit, offset })
})

/** 商城站商品详情：仅当该商品已被某店铺上架时才返回。价格取自 products.purchase_price / products.selling_price 与 product_skus.purchase_price / product_skus.selling_price，不使用 product_i18n。 */
productsRouter.get('/:id', async (req, res) => {
  const id = req.params.id
  if (pool) {
    try {
      const client = await pool().connect()
      try {
        const r = await client.query(
          `SELECT p.product_id, p.goods_id, p.category_id, p.sub_category_id, p.product_name,
                  p.purchase_price, p.selling_price, p.description_html, p.detail_html, p.main_images,
                  sp.price AS listing_price, sp.shop_id,
                  c.name_en AS category_name, sc.name_en AS sub_category_name
           FROM products p
           INNER JOIN shop_products sp ON sp.product_id = p.product_id AND sp.status = 'on'
           LEFT JOIN categories c ON c.category_id = p.category_id
           LEFT JOIN categories sc ON sc.category_id = p.sub_category_id
           WHERE p.product_id = $1
           LIMIT 1`,
          [id]
        )
        const row = r.rows[0]
        if (!row) {
          res.status(404).json({ success: false, message: '商品不存在或未上架' })
          return
        }
        const mainImages = row.main_images ?? []
        const listingPrice = row.listing_price != null ? Number(row.listing_price) : null
        const productPrice = Number(row.selling_price) || 0
        const skuRes = await client.query(
          `SELECT ps.sku_id, ps.product_id, ps.attrs, ps.purchase_price, ps.selling_price, ps.cover_img, ps.images
           FROM product_skus ps WHERE ps.product_id = $1 LIMIT 50`,
          [id]
        )
        res.json({
          id: row.product_id,
          goodsId: row.goods_id,
          title: row.product_name,
          image: Array.isArray(mainImages) && mainImages[0] ? mainImages[0] : '',
          images: mainImages,
          price: listingPrice != null ? listingPrice : productPrice,
          shopId: row.shop_id,
          purchasePrice: row.purchase_price != null ? Number(row.purchase_price) : null,
          category: row.category_name ?? row.category_id,
          subCategory: row.sub_category_name ?? row.sub_category_id,
          descriptionHtml: row.description_html,
          detailHtml: row.detail_html,
          skus: skuRes.rows.map((s: Record<string, unknown>) => ({
            skuId: s.sku_id,
            productId: s.product_id,
            attrs: s.attrs,
            purchasePrice: s.purchase_price != null ? Number(s.purchase_price) : null,
            sellingPrice: s.selling_price != null ? Number(s.selling_price) : null,
            coverImg: s.cover_img,
            images: s.images ?? [],
          })),
        })
        return
      } finally {
        client.release()
      }
    } catch (e) {
      console.error('[products/:id] db error', e)
      res.status(500).json({ success: false, message: '数据库查询失败' })
      return
    }
  }

  const product = store.products.get(id)
  if (!product) {
    res.status(404).json({ success: false, message: '商品不存在' })
    return
  }
  res.json(product)
})

/** 以下写操作仍走内存（或后续可改为写 DB） */
productsRouter.post('/', (req, res) => {
  const body = req.body as { shopId?: string; title?: string; image?: string; price?: number; category?: string; subCategory?: string }
  if (!body.shopId || !body.title) {
    res.status(400).json({ success: false, message: '缺少 shopId 或 title' })
    return
  }
  const id = 'P' + Date.now()
  const product = {
    id,
    shopId: body.shopId,
    title: body.title,
    image: body.image ?? '',
    price: Number(body.price) || 0,
    category: body.category ?? '',
    subCategory: body.subCategory ?? '',
    status: 'on' as const,
    sales: 0,
    createdAt: new Date().toISOString(),
  }
  store.products.set(id, product as import('../store.js').Product)
  res.status(201).json(product)
})

productsRouter.patch('/:id', async (req, res) => {
  const id = req.params.id
  if (pool) {
    res.status(400).json({ success: false, message: '商品数据来自数据库，暂不支持在此修改' })
    return
  }
  const product = store.products.get(id)
  if (!product) {
    res.status(404).json({ success: false, message: '商品不存在' })
    return
  }
  const body = req.body as Record<string, unknown>
  if (body.status === 'on' || body.status === 'off') product.status = body.status
  if (typeof body.title === 'string') product.title = body.title
  if (typeof body.price === 'number') product.price = body.price
  if (typeof body.image === 'string') product.image = body.image
  res.json({ success: true })
})
