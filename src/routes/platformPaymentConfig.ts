import { Router } from 'express'
import { getPool } from '../db.js'

export const platformPaymentConfigRouter = Router()

/** 公开接口：获取平台统一收款配置，供商城充值、店铺充值页展示 */
platformPaymentConfigRouter.get('/', async (_req, res) => {
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
    console.error('[platform-payment-config]', e)
    res.status(500).json({ receiveAddress: '', receiveQrUrl: '' })
  }
})
