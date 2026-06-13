import { Router } from 'express'
import { assertShopOwnerByUserId } from '../db/shopFundApplicationsDb.js'
import { subscribeMerchantEvents } from '../db/merchantEventHub.js'

export const merchantEventsRouter = Router()

/** SSE：商家端实时 sync 推送（需 shopId + userId 校验店主身份） */
merchantEventsRouter.get('/merchant/events', (req, res) => {
  const shopId = typeof req.query.shopId === 'string' ? req.query.shopId.trim() : ''
  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : ''

  if (!shopId || !userId) {
    res.status(400).json({ success: false, message: '缺少 shopId 或 userId' })
    return
  }

  void (async () => {
    const auth = await assertShopOwnerByUserId(shopId, userId)
    if (!auth.ok) {
      res.status(403).json({ success: false, message: auth.message ?? '无权限' })
      return
    }

    const unsubscribe = subscribeMerchantEvents(shopId, res)

    req.on('close', () => {
      unsubscribe()
    })
  })()
})
