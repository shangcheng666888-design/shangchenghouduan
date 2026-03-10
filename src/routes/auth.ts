import { Router } from 'express'
import fetch from 'node-fetch'
import { getByAccount, getById, nextUserId, createUser } from '../db/usersDb.js'
import { getPool } from '../db.js'

export const authRouter = Router()

authRouter.post('/login', async (req, res) => {
  try {
    const { value, password } = req.body as { value?: string; password?: string }
    if (!value || !password) {
      res.status(400).json({ success: false, message: '缺少账号或密码' })
      return
    }
    const account = String(value).trim()
    const user = await getByAccount(account)
    if (!user || user.password !== password) {
      res.status(401).json({ success: false, message: '账号或密码错误' })
      return
    }
    if (user.status === 'disabled') {
      res.status(403).json({ success: false, message: '账号已被禁用，请联系客服人员' })
      return
    }
    res.json({
      success: true,
      user: { id: user.id, account: user.account, balance: user.balance, shopId: user.shopId, isBot: user.isBot ?? false, avatar: user.avatar ?? null },
    })
  } catch (e) {
    console.error('[auth login]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 店铺登录：仅允许已开通店铺的账号（user.shopId 不为空） */
authRouter.post('/shop-login', async (req, res) => {
  try {
    const { value, password } = req.body as { value?: string; password?: string }
    if (!value || !password) {
      res.status(400).json({ success: false, message: '缺少账号或密码' })
      return
    }
    const account = String(value).trim()
    const user = await getByAccount(account)
    if (!user || user.password !== password) {
      res.status(401).json({ success: false, message: '账号或密码错误' })
      return
    }
    if (user.status === 'disabled') {
      res.status(403).json({ success: false, message: '账号已被禁用，请联系客服人员' })
      return
    }
    if (!user.shopId || user.shopId.trim() === '') {
      res.status(403).json({ success: false, message: '该账号未开通店铺，请先申请入驻' })
      return
    }

    // 记录店铺最近登录 IP 及其国家信息
    const rawForwarded = (req.headers['x-forwarded-for'] as string | undefined) || ''
    const clientIp =
      rawForwarded.split(',')[0]?.trim() ||
      (req.socket.remoteAddress ?? '')

    ;(async () => {
      try {
        const pool = getPool()
        let country: string | null = null
        const ip = clientIp && clientIp !== '::1' ? clientIp : ''
        if (ip) {
          try {
            const resp = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`)
            if (resp.ok) {
              const data = (await resp.json()) as { country_name?: string | null }
              if (data && typeof data.country_name === 'string' && data.country_name.trim()) {
                country = data.country_name.trim()
              }
            }
          } catch {
            // 忽略 IP 位置解析失败，不影响登录
          }
        }
        await pool.query(
          'UPDATE shops SET last_login_ip = $1, last_login_country = $2 WHERE id = $3',
          [ip || null, country, user.shopId],
        )
      } catch {
        // 后台记录失败不影响用户登录
      }
    })().catch(() => {})
    res.json({
      success: true,
      user: { id: user.id, account: user.account, balance: user.balance, shopId: user.shopId, isBot: user.isBot ?? false, avatar: user.avatar ?? null },
    })
  } catch (e) {
    console.error('[auth shop-login]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

authRouter.post('/register', async (req, res) => {
  try {
    const { account, password, type } = req.body as { account?: string; password?: string; type?: 'email' | 'phone' }
    if (!account?.trim() || !password) {
      res.status(400).json({ success: false, message: '请填写账号和密码' })
      return
    }
    const existing = await getByAccount(account.trim())
    if (existing) {
      const msg = type === 'phone' ? '该手机号已注册' : type === 'email' ? '该邮箱已注册' : '该账号已注册'
      res.status(409).json({ success: false, message: msg })
      return
    }
    const id = await nextUserId()
    await createUser({
      id,
      account: account.trim(),
      password,
      balance: 0,
      addresses: [],
      shopId: null,
    })
    const created = await getById(id)
    res.status(201).json({
      success: true,
      user: { id, account: account.trim(), balance: 0, shopId: null, isBot: false, avatar: created?.avatar ?? null },
    })
  } catch (e) {
    console.error('[auth register]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})
