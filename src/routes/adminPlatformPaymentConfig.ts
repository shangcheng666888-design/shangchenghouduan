import { Router, type Request } from 'express'
import { getPool } from '../db.js'

export const adminPlatformPaymentConfigRouter = Router()

/** 管理员：获取平台统一收款配置 */
adminPlatformPaymentConfigRouter.get('/', async (_req, res) => {
  try {
    const pool = getPool()
    const r = await pool.query<{ receive_address: string; receive_qr_url: string }>(
      `SELECT receive_address, receive_qr_url FROM platform_payment_config WHERE id = 1 LIMIT 1`
    )
    const row = r.rows[0]
    res.json({
      receiveAddress: row?.receive_address ?? '',
      receiveQrUrl: row?.receive_qr_url ?? '',
    })
  } catch (e) {
    console.error('[admin platform-payment-config get]', e)
    res.status(500).json({ message: '获取失败' })
  }
})

/** 管理员：更新平台统一收款配置（收款地址、收款二维码 URL）。必须同时提交收款地址与收款二维码，否则拒绝。 */
adminPlatformPaymentConfigRouter.put('/', async (req: Request, res) => {
  try {
    const body = req.body as { receiveAddress?: string; receiveQrUrl?: string | null }
    const receiveAddress = typeof body.receiveAddress === 'string' ? body.receiveAddress.trim() : ''
    const receiveQrUrl =
      body.receiveQrUrl === null || body.receiveQrUrl === undefined
        ? ''
        : (typeof body.receiveQrUrl === 'string' ? body.receiveQrUrl.trim() : '')

    if (!receiveAddress || !receiveQrUrl) {
      res.status(400).json({ message: '请同时填写收款地址与收款二维码' })
      return
    }

    const pool = getPool()
    await pool.query(
      `UPDATE platform_payment_config SET receive_address = $1, receive_qr_url = $2 WHERE id = 1`,
      [receiveAddress, receiveQrUrl]
    )
    res.json({ success: true })
  } catch (e) {
    console.error('[admin platform-payment-config put]', e)
    res.status(500).json({ message: '保存失败' })
  }
})
