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
      eth_qr_url: string
      btc_qr_url: string
      trc20_qr_url: string
    }>(
      `SELECT receive_address,
              receive_qr_url,
              eth_address,
              btc_address,
              trc20_address,
              eth_qr_url,
              btc_qr_url,
              trc20_qr_url
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
      ethQrUrl: row?.eth_qr_url ?? '',
      btcQrUrl: row?.btc_qr_url ?? '',
      trc20QrUrl: row?.trc20_qr_url ?? '',
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
      ethQrUrl?: string | null
      btcQrUrl?: string | null
      trc20QrUrl?: string | null
    }
    // 兼容旧字段：receiveAddress/receiveQrUrl 视为 TRC20 默认配置，
    // 但以显式传入的 trc20Address/trc20QrUrl 为准。
    const trc20AddressRaw =
      typeof body.trc20Address === 'string'
        ? body.trc20Address
        : typeof body.receiveAddress === 'string'
          ? body.receiveAddress
          : ''
    const trc20QrUrlRaw =
      body.trc20QrUrl === null || body.trc20QrUrl === undefined
        ? body.receiveQrUrl
        : body.trc20QrUrl

    const trc20Address = trc20AddressRaw.trim()
    const trc20QrUrl =
      trc20QrUrlRaw === null || trc20QrUrlRaw === undefined
        ? ''
        : (typeof trc20QrUrlRaw === 'string' ? trc20QrUrlRaw.trim() : '')

    if (!trc20Address || !trc20QrUrl) {
      res
        .status(400)
        .json({ message: '请填写 USDT‑TRC20 的地址与二维码' })
      return
    }

    const ethAddress = typeof body.ethAddress === 'string' ? body.ethAddress.trim() : ''
    const btcAddress = typeof body.btcAddress === 'string' ? body.btcAddress.trim() : ''
    const ethQrUrl =
      body.ethQrUrl === null || body.ethQrUrl === undefined
        ? ''
        : (typeof body.ethQrUrl === 'string' ? body.ethQrUrl.trim() : '')
    const btcQrUrl =
      body.btcQrUrl === null || body.btcQrUrl === undefined
        ? ''
        : (typeof body.btcQrUrl === 'string' ? body.btcQrUrl.trim() : '')

    const pool = getPool()
    await pool.query(
      `UPDATE platform_payment_config
       SET receive_address = $1,
           receive_qr_url  = $2,
           eth_address     = $3,
           btc_address     = $4,
           trc20_address   = $5,
           eth_qr_url      = $6,
           btc_qr_url      = $7,
           trc20_qr_url    = $8
       WHERE id = 1`,
      [
        // 全局默认仍使用 TRC20 这一套，兼容旧前端
        trc20Address,
        trc20QrUrl,
        ethAddress,
        btcAddress,
        trc20Address,
        ethQrUrl,
        btcQrUrl,
        trc20QrUrl,
      ],
    )
    res.json({ success: true })
  } catch (e) {
    console.error('[admin platform-payment-config put]', e)
    res.status(500).json({ message: '保存失败' })
  }
})

