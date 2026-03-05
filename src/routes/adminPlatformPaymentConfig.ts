import { Router, type Request } from 'express'
import { getPool } from '../db.js'

export const adminPlatformPaymentConfigRouter = Router()

/** 管理员：获取平台统一收款配置 */
adminPlatformPaymentConfigRouter.get('/', async (_req, res) => {
  try {
    const pool = getPool()
    const r = await pool.query<{
      receive_address: string
      receive_qr_url: string
      eth_address: string
      btc_address: string
      trc20_address: string
    }>(
      `SELECT receive_address, receive_qr_url, eth_address, btc_address, trc20_address
       FROM platform_payment_config
       WHERE id = 1
       LIMIT 1`,
    )
    const row = r.rows[0]
    res.json({
      receiveAddress: row?.receive_address ?? '',
      receiveQrUrl: row?.receive_qr_url ?? '',
      ethAddress: row?.eth_address ?? '',
      btcAddress: row?.btc_address ?? '',
      trc20Address: row?.trc20_address ?? '',
    })
  } catch (e) {
    console.error('[admin platform-payment-config get]', e)
    res.status(500).json({ message: '获取失败' })
  }
})

/**
 * 管理员：更新平台统一收款配置。
 * - receiveAddress / receiveQrUrl 仍为必填（默认地址+二维码）
 * - ethAddress / btcAddress / trc20Address 可选（分别对应 ETH 网络、BTC 网络、USDT‑TRC20 网络）
 */
adminPlatformPaymentConfigRouter.put('/', async (req: Request, res) => {
  try {
    const body = req.body as {
      receiveAddress?: string
      receiveQrUrl?: string | null
      ethAddress?: string | null
      btcAddress?: string | null
      trc20Address?: string | null
    }
    const receiveAddress = typeof body.receiveAddress === 'string' ? body.receiveAddress.trim() : ''
    const receiveQrUrl =
      body.receiveQrUrl === null || body.receiveQrUrl === undefined
        ? ''
        : (typeof body.receiveQrUrl === 'string' ? body.receiveQrUrl.trim() : '')

    if (!receiveAddress || !receiveQrUrl) {
      res.status(400).json({ message: '请同时填写收款地址与收款二维码' })
      return
    }

    const ethAddress = typeof body.ethAddress === 'string' ? body.ethAddress.trim() : ''
    const btcAddress = typeof body.btcAddress === 'string' ? body.btcAddress.trim() : ''
    const trc20Address = typeof body.trc20Address === 'string' ? body.trc20Address.trim() : ''

    const pool = getPool()
    await pool.query(
      `UPDATE platform_payment_config
       SET receive_address = $1,
           receive_qr_url  = $2,
           eth_address     = $3,
           btc_address     = $4,
           trc20_address   = $5
       WHERE id = 1`,
      [receiveAddress, receiveQrUrl, ethAddress, btcAddress, trc20Address],
    )
    res.json({ success: true })
  } catch (e) {
    console.error('[admin platform-payment-config put]', e)
    res.status(500).json({ message: '保存失败' })
  }
})

