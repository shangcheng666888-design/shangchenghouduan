import { Router } from 'express'
import { getPool } from '../db.js'
import {
  createPromotion,
  getPromotionById,
  getPromotionMetrics,
  listPromotions,
  updatePromotion,
  upsertPromotionMetrics,
  type PaidChannel,
  type PromoStatus,
} from '../db/paidPromotionsDb.js'

export const adminPaidPromotionsRouter = Router()

adminPaidPromotionsRouter.get('/', async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined
    const list = await listPromotions({ status })
    res.json({ list })
  } catch (e) {
    console.error('[admin paid-promotions list]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

adminPaidPromotionsRouter.get('/shops-options', async (_req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM shops WHERE status = 'normal' ORDER BY created_at DESC`,
    )
    res.json({
      list: result.rows.map((row) => ({ id: row.id, name: row.name })),
    })
  } catch (e) {
    console.error('[admin paid-promotions shops-options]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

adminPaidPromotionsRouter.post('/', async (req, res) => {
  try {
    const shopId = typeof req.body?.shopId === 'string' ? req.body.shopId.trim() : ''
    const channel = typeof req.body?.channel === 'string' ? req.body.channel.trim() : ''
    const status = (typeof req.body?.status === 'string' ? req.body.status.trim() : 'active') as PromoStatus
    const adminNote = typeof req.body?.adminNote === 'string' ? req.body.adminNote.trim() : ''
    if (!shopId || !channel) {
      res.status(400).json({ success: false, message: '请选择店铺与推广渠道' })
      return
    }
    const pool = getPool()
    const shopRes = await pool.query('SELECT id FROM shops WHERE id = $1', [shopId])
    if (shopRes.rows.length === 0) {
      res.status(404).json({ success: false, message: '店铺不存在' })
      return
    }
    const promotion = await createPromotion({
      shopId,
      channel: channel as PaidChannel,
      status,
      adminNote: adminNote || null,
    })
    res.json({ success: true, promotion })
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    if (message === 'invalid_channel') {
      res.status(400).json({ success: false, message: '推广渠道无效' })
      return
    }
    console.error('[admin paid-promotions create]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

adminPaidPromotionsRouter.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ success: false, message: '无效 ID' })
      return
    }
    const patch: { channel?: PaidChannel; status?: PromoStatus; adminNote?: string | null } = {}
    if (req.body?.channel !== undefined) patch.channel = req.body.channel
    if (req.body?.status !== undefined) patch.status = req.body.status
    if (req.body?.adminNote !== undefined) patch.adminNote = req.body.adminNote
    const promotion = await updatePromotion(id, patch)
    if (!promotion) {
      res.status(404).json({ success: false, message: '推广记录不存在' })
      return
    }
    res.json({ success: true, promotion })
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    if (message === 'invalid_channel' || message === 'invalid_status') {
      res.status(400).json({ success: false, message: '参数无效' })
      return
    }
    console.error('[admin paid-promotions patch]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

adminPaidPromotionsRouter.get('/:id/metrics', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ success: false, message: '无效 ID' })
      return
    }
    const promotion = await getPromotionById(id)
    if (!promotion) {
      res.status(404).json({ success: false, message: '推广记录不存在' })
      return
    }
    const metrics = await getPromotionMetrics(id, 7)
    res.json({ promotion, ...metrics })
  } catch (e) {
    console.error('[admin paid-promotions metrics get]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

adminPaidPromotionsRouter.put('/:id/metrics', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ success: false, message: '无效 ID' })
      return
    }
    const promotion = await getPromotionById(id)
    if (!promotion) {
      res.status(404).json({ success: false, message: '推广记录不存在' })
      return
    }
    const metrics = Array.isArray(req.body?.metrics) ? req.body.metrics : []
    const result = await upsertPromotionMetrics(id, metrics)
    res.json({ success: true, ...result })
  } catch (e) {
    console.error('[admin paid-promotions metrics put]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})
