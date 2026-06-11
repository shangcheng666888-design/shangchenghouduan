import { Router } from 'express'
import { assertShopOwnerByUserId } from '../db/shopFundApplicationsDb.js'
import {
  getActivePromotionByShopId,
  getPromotionMetrics,
  setPromotionTarget,
} from '../db/paidPromotionsDb.js'

export const paidPromotionsRouter = Router()

paidPromotionsRouter.get('/shops/:shopId/paid-promotion', async (req, res) => {
  try {
    const shopId = req.params.shopId
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : ''
    if (!userId) {
      res.status(400).json({ success: false, message: '缺少 userId' })
      return
    }
    const auth = await assertShopOwnerByUserId(shopId, userId)
    if (!auth.ok) {
      res.status(403).json({ success: false, message: auth.message ?? '无权限' })
      return
    }
    const promotion = await getActivePromotionByShopId(shopId)
    if (!promotion) {
      res.json({ active: false, promotion: null, metrics: null })
      return
    }
    const metrics = promotion.targetType
      ? await getPromotionMetrics(promotion.id, 7)
      : { series: [], totals: { impressions: 0, clicks: 0, visits: 0, orders: 0, spend: 0, revenue: 0 } }
    res.json({
      active: true,
      promotion,
      metrics,
      targetSelected: Boolean(promotion.targetType),
    })
  } catch (e) {
    console.error('[paid-promotion GET]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

paidPromotionsRouter.patch('/shops/:shopId/paid-promotion', async (req, res) => {
  try {
    const shopId = req.params.shopId
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : ''
    const targetType = req.body?.targetType
    const targetListingId = req.body?.targetListingId
    if (!userId) {
      res.status(400).json({ success: false, message: '缺少 userId' })
      return
    }
    const auth = await assertShopOwnerByUserId(shopId, userId)
    if (!auth.ok) {
      res.status(403).json({ success: false, message: auth.message ?? '无权限' })
      return
    }
    const promotion = await getActivePromotionByShopId(shopId)
    if (!promotion) {
      res.status(404).json({ success: false, message: '当前店铺未开启付费推广' })
      return
    }
    const updated = await setPromotionTarget(promotion.id, { targetType, targetListingId })
    const metrics = updated?.targetType
      ? await getPromotionMetrics(updated.id, 7)
      : { series: [], totals: { impressions: 0, clicks: 0, visits: 0, orders: 0, spend: 0, revenue: 0 } }
    res.json({
      success: true,
      promotion: updated,
      metrics,
      targetSelected: Boolean(updated?.targetType),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    if (message === 'invalid_target_type') {
      res.status(400).json({ success: false, message: '推广目标类型无效' })
      return
    }
    if (message === 'listing_required') {
      res.status(400).json({ success: false, message: '请选择要推广的商品' })
      return
    }
    if (message === 'listing_not_found') {
      res.status(400).json({ success: false, message: '商品不存在或未上架' })
      return
    }
    if (message === 'promotion_not_active') {
      res.status(400).json({ success: false, message: '付费推广未处于进行中状态' })
      return
    }
    console.error('[paid-promotion PATCH]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})
