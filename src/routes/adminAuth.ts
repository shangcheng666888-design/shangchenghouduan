import { Router } from 'express'
import { scryptSync, timingSafeEqual } from 'crypto'
import speakeasy from 'speakeasy'
import { getPool } from '../db.js'
import { createAdminToken, verifyAdminToken } from '../adminSession.js'

const SALT = 'admin-fafa-salt-v1'

export const adminAuthRouter = Router()

function hashPassword(password: string): string {
  return scryptSync(password, SALT, 64).toString('hex')
}

function verifyPassword(input: string, storedHash: string): boolean {
  const h = hashPassword(input)
  if (h.length !== storedHash.length) return false
  try {
    return timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(storedHash, 'hex'))
  } catch {
    return false
  }
}

adminAuthRouter.post('/login', async (req, res) => {
  const { username, password, totpToken } = (req.body as {
    username?: string
    password?: string
    totpToken?: string
  }) ?? {}
  if (!username?.trim() || !password) {
    res.status(400).json({ success: false, message: '请输入用户名和密码' })
    return
  }
  const tokenStr = typeof totpToken === 'string' ? totpToken.replace(/\s/g, '') : ''
  if (!tokenStr || tokenStr.length !== 6) {
    res.status(400).json({ success: false, message: '请输入 6 位谷歌验证码' })
    return
  }
  try {
    const pool = getPool()
    const r = await pool.query<{ username: string; password_hash: string; totp_secret: string | null }>(
      'SELECT username, password_hash, totp_secret FROM admin_users WHERE username = $1 LIMIT 1',
      [username.trim()]
    )
    const row = r.rows[0]
    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ success: false, message: '用户名或密码错误' })
      return
    }
    if (!row.totp_secret || !row.totp_secret.trim()) {
      res.status(403).json({ success: false, message: '该账号尚未绑定谷歌验证器，请联系系统管理员' })
      return
    }
    const verified = speakeasy.totp.verify({
      secret: row.totp_secret,
      encoding: 'base32',
      token: tokenStr,
      window: 1,
    })
    if (!verified) {
      res.status(401).json({ success: false, message: '谷歌验证码错误或已过期，请重新输入' })
      return
    }
    const token = createAdminToken(row.username)
    res.json({
      success: true,
      admin: { username: row.username },
      token,
    })
  } catch (e) {
    console.error('[admin auth login]', e)
    res.status(500).json({ success: false, message: '登录失败，请稍后重试' })
  }
})

/** 校验管理员登录态，供前端 AdminLayout 调用；需携带 Authorization: Bearer <token> */
adminAuthRouter.get('/verify', (req, res) => {
  const auth = req.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null
  if (!token || !verifyAdminToken(token)) {
    res.status(401).json({ success: false, message: '未登录或登录已过期，请重新登录' })
    return
  }
  res.json({ success: true, ok: true })
})
