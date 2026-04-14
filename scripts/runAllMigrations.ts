/**
 * 按文件名顺序执行 migrations 目录下所有未执行过的 .sql 迁移。
 * 用于部署时自动迁移（如 Render Release Command: npm run migrate:all）
 * 用法: npx tsx scripts/runAllMigrations.ts
 */
import 'dotenv/config'
import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { getPool } from '../src/db.js'

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations')
const TABLE = 'schema_migrations'

async function main() {
  const pool = getPool()

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      name text PRIMARY KEY,
      executed_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const executed = await pool.query<{ name: string }>(
    `SELECT name FROM ${TABLE}`
  )
  const done = new Set(executed.rows.map((r) => r.name))

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (done.has(file)) {
      console.log(`[migrate] 已执行过，跳过: ${file}`)
      continue
    }
    const fullPath = path.join(MIGRATIONS_DIR, file)
    const sql = readFileSync(fullPath, 'utf8')
    await pool.query(sql)
    await pool.query(
      `INSERT INTO ${TABLE} (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [file]
    )
    console.log(`[migrate] 已执行: ${file}`)
  }

  console.log('[migrate] 全部完成')
  process.exit(0)
}

main().catch((err) => {
  console.error('[migrate] 失败:', err)
  const code = (err as { code?: string })?.code
  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'EAI_AGAIN') {
    console.warn('[migrate] 数据库不可达，跳过迁移，服务器继续启动')
    process.exit(0)
  }
  process.exit(1)
})
