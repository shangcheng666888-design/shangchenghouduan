import { Router } from 'express'
import { getPool } from '../db.js'

export const cartRouter = Router()

function isCartTableMissing(e: unknown): boolean {
  const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
  return code === '42P01' || (e instanceof Error && e.message?.includes('user_cart'))
}

/** 与前端 CartItem 一致 */
interface CartItemBody {
  id: string
  shopId?: string
  productId?: string
  title: string
  price: number
  quantity: number
  image?: string
  spec?: string
}

/** GET /api/cart?userId=xxx 获取用户购物车 */
cartRouter.get('/', async (req, res) => {
  const userId = (req.query.userId as string)?.trim()
  if (!userId) {
    res.status(400).json({ success: false, message: '缺少 userId' })
    return
  }
  try {
    const pool = getPool()
    const rows = await pool.query<{
      item_id: string
      shop_id: string | null
      product_id: string | null
      title: string
      price: string
      quantity: number
      image: string | null
      spec: string | null
    }>(
      `SELECT item_id, shop_id, product_id, title, price, quantity, image, spec
       FROM user_cart
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId],
    )
    const items: CartItemBody[] = rows.rows.map((r) => ({
      id: r.item_id,
      shopId: r.shop_id ?? undefined,
      productId: r.product_id ?? undefined,
      title: r.title,
      price: Number(r.price ?? 0),
      quantity: r.quantity ?? 1,
      image: r.image ?? undefined,
      spec: r.spec ?? undefined,
    }))
    res.json({ items })
  } catch (e: unknown) {
    if (isCartTableMissing(e)) {
      console.warn('[cart get] user_cart 表不存在，请执行: node scripts/run-migration.js 016')
      return res.json({ items: [] })
    }
    console.error('[cart get]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

/** POST /api/cart/items 添加或更新一项（body: { userId, item }） */
cartRouter.post('/items', async (req, res) => {
  const body = req.body as { userId?: string; item?: CartItemBody }
  const userId = body.userId?.trim()
  const item = body.item
  if (!userId || !item || typeof item.id !== 'string' || !item.title || typeof item.price !== 'number') {
    res.status(400).json({ success: false, message: '缺少 userId 或 item 字段' })
    return
  }
  const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1))
  try {
    const pool = getPool()
    await pool.query(
      `INSERT INTO user_cart (user_id, item_id, shop_id, product_id, title, price, quantity, image, spec, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (user_id, item_id)
       DO UPDATE SET
         quantity = user_cart.quantity + EXCLUDED.quantity,
         title = EXCLUDED.title,
         price = EXCLUDED.price,
         image = EXCLUDED.image,
         spec = EXCLUDED.spec,
         updated_at = NOW()`,
      [
        userId,
        item.id,
        item.shopId ?? null,
        item.productId ?? null,
        item.title,
        item.price,
        quantity,
        item.image ?? null,
        item.spec ?? null,
      ],
    )
    res.json({ success: true })
  } catch (e: unknown) {
    if (isCartTableMissing(e)) {
      console.warn('[cart] user_cart 表不存在，请执行: node scripts/run-migration.js 016')
      return res.json({ success: true })
    }
    console.error('[cart post item]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

/** PATCH /api/cart/items/:itemId 更新数量（body: { userId, quantity }） */
cartRouter.patch('/items/:itemId', async (req, res) => {
  const itemId = req.params.itemId
  const body = req.body as { userId?: string; quantity?: number }
  const userId = body.userId?.trim()
  const quantity = Math.max(0, Math.floor(Number(body.quantity) ?? 0))
  if (!userId) {
    res.status(400).json({ success: false, message: '缺少 userId' })
    return
  }
  try {
    const pool = getPool()
    if (quantity <= 0) {
      await pool.query('DELETE FROM user_cart WHERE user_id = $1 AND item_id = $2', [userId, itemId])
    } else {
      const r = await pool.query(
        'UPDATE user_cart SET quantity = $1, updated_at = NOW() WHERE user_id = $2 AND item_id = $3',
        [quantity, userId, itemId],
      )
      if (r.rowCount === 0) {
        res.status(404).json({ success: false, message: '购物车项不存在' })
        return
      }
    }
    res.json({ success: true })
  } catch (e: unknown) {
    if (isCartTableMissing(e)) {
      console.warn('[cart] user_cart 表不存在，请执行: node scripts/run-migration.js 016')
      return res.json({ success: true })
    }
    console.error('[cart patch item]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

/** DELETE /api/cart/items/:itemId?userId=xxx 删除一项 */
cartRouter.delete('/items/:itemId', async (req, res) => {
  const itemId = req.params.itemId
  const userId = (req.query.userId as string)?.trim()
  if (!userId) {
    res.status(400).json({ success: false, message: '缺少 userId' })
    return
  }
  try {
    const pool = getPool()
    await pool.query('DELETE FROM user_cart WHERE user_id = $1 AND item_id = $2', [userId, itemId])
    res.json({ success: true })
  } catch (e: unknown) {
    if (isCartTableMissing(e)) {
      console.warn('[cart] user_cart 表不存在，请执行: node scripts/run-migration.js 016')
      return res.json({ success: true })
    }
    console.error('[cart delete item]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

/** PUT /api/cart 全量替换购物车（body: { userId, items }） */
cartRouter.put('/', async (req, res) => {
  const body = req.body as { userId?: string; items?: CartItemBody[] }
  const userId = body.userId?.trim()
  const items = Array.isArray(body.items) ? body.items : []
  if (!userId) {
    res.status(400).json({ success: false, message: '缺少 userId' })
    return
  }
  try {
    const pool = getPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM user_cart WHERE user_id = $1', [userId])
      for (const item of items) {
        if (!item?.id || !item.title || typeof item.price !== 'number') continue
        const qty = Math.max(1, Math.floor(Number(item.quantity) || 1))
        await client.query(
          `INSERT INTO user_cart (user_id, item_id, shop_id, product_id, title, price, quantity, image, spec, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [
            userId,
            item.id,
            item.shopId ?? null,
            item.productId ?? null,
            item.title,
            item.price,
            qty,
            item.image ?? null,
            item.spec ?? null,
          ],
        )
      }
      await client.query('COMMIT')
      res.json({ success: true })
    } finally {
      client.release()
    }
  } catch (e: unknown) {
    if (isCartTableMissing(e)) {
      console.warn('[cart] user_cart 表不存在，请执行: node scripts/run-migration.js 016')
      return res.json({ success: true })
    }
    console.error('[cart put]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})
