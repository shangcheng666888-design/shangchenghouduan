import { createHmac, timingSafeEqual } from 'crypto'

const SECRET = process.env.ADMIN_SESSION_SECRET ?? 'admin-fafa-session-secret-v1'

/**
 * 生成管理员会话 token，前端存 localStorage，可选用于请求头校验
 */
export function createAdminToken(username: string): string {
  const payload = JSON.stringify({ username, iat: Math.floor(Date.now() / 1000) })
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex')
  return Buffer.from(`${payload}::${sig}`).toString('base64url')
}

/**
 * 校验并解析 admin token，用于后端需要校验管理员身份的接口
 */
export function verifyAdminToken(token: string): { username: string } | null {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8')
    const [payloadStr, sig] = raw.split('::')
    if (!payloadStr || !sig) return null
    const expected = createHmac('sha256', SECRET).update(payloadStr).digest('hex')
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null
    const payload = JSON.parse(payloadStr) as { username?: string }
    return payload.username ? { username: payload.username } : null
  } catch {
    return null
  }
}
