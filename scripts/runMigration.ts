/**
 * 执行指定迁移文件（用于 017 等单文件 SQL 迁移）
 * 用法: npx tsx scripts/runMigration.ts migrations/017_admin_users.sql
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import path from 'path'
import { getPool } from '../src/db.js'

const migrationPath = process.argv[2]
if (!migrationPath) {
  console.error('用法: npx tsx scripts/runMigration.ts <迁移文件路径>')
  process.exit(1)
}

const fullPath = path.resolve(process.cwd(), migrationPath)
const sql = readFileSync(fullPath, 'utf8')

async function main() {
  const pool = getPool()
  await pool.query(sql)
  console.log(`[migration] 已执行: ${migrationPath}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('[migration] 失败:', err)
  process.exit(1)
})
