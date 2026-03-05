/**
 * 为指定管理员账号生成谷歌验证器（TOTP）密钥并写入数据库。
 * 运行后请用 Google Authenticator 等 App 扫描输出的链接或输入密钥绑定。
 *
 * 用法: npx tsx scripts/setupAdminTotp.ts <用户名>
 * 示例: npx tsx scripts/setupAdminTotp.ts fafa2026
 */
import 'dotenv/config'
import speakeasy from 'speakeasy'
import { getPool } from '../src/db.js'

const username = process.argv[2]?.trim()
if (!username) {
  console.error('用法: npx tsx scripts/setupAdminTotp.ts <用户名>')
  console.error('示例: npx tsx scripts/setupAdminTotp.ts fafa2026')
  process.exit(1)
}

async function main() {
  const pool = getPool()
  const r = await pool.query<{ id: number }>(
    'SELECT id FROM admin_users WHERE username = $1 LIMIT 1',
    [username]
  )
  if (r.rows.length === 0) {
    console.error(`管理员账号不存在: ${username}`)
    process.exit(1)
  }

  const secret = speakeasy.generateSecret({
    name: `商城管理后台 (${username})`,
    length: 20,
  })
  const base32 = secret.base32
  if (!base32) {
    console.error('生成 TOTP 密钥失败')
    process.exit(1)
  }

  await pool.query(
    'UPDATE admin_users SET totp_secret = $1 WHERE username = $2',
    [base32, username]
  )

  console.log('')
  console.log('已为以下账号绑定谷歌验证器密钥（请勿泄露）：')
  console.log('  用户名:', username)
  console.log('')
  console.log('请使用 Google Authenticator 等 App：')
  console.log('  1. 扫描下方链接（二维码）绑定，或')
  console.log('  2. 手动输入密钥:', base32)
  console.log('')
  console.log('otpauth 链接（可转为二维码后扫描）：')
  console.log(secret.otpauth_url || `otpauth://totp/Admin:${encodeURIComponent(username)}?secret=${base32}&issuer=商城管理后台`)
  console.log('')
  console.log('绑定完成后，登录时需输入账号、密码和 App 中的 6 位动态码。')
  console.log('')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
