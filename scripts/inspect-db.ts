/**
 * 查看数据库中表结构及商品相关表内容。运行: npx tsx scripts/inspect-db.ts
 * 需配置 .env 中的 DB_DSN
 */
import 'dotenv/config'
import pg from 'pg'

const { Client } = pg

async function main() {
  const dsn = process.env.DB_DSN
  if (!dsn) {
    console.error('请设置 .env 中的 DB_DSN')
    process.exit(1)
  }
  const client = new Client({ connectionString: dsn })
  try {
    await client.connect()
    console.log('已连接数据库\n')

    const tablesRes = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema IN ('public', 'storage')
      ORDER BY table_schema, table_name
    `)
    console.log('=== 表列表 ===')
    for (const row of tablesRes.rows) {
      console.log(`${row.table_schema}.${row.table_name}`)
    }

    const productLike = tablesRes.rows.filter(
      (r) =>
        /product|commodity|商品|producto/i.test(r.table_name) ||
        (r.table_schema === 'public' && ['products', 'commodity', 'commodities'].includes(r.table_name))
    )
    const tablesToInspect = productLike.length > 0 ? productLike : tablesRes.rows.filter((r) => r.table_schema === 'public')

    for (const { table_schema, table_name } of tablesToInspect) {
      const fullName = `${table_schema}.${table_name}`
      console.log(`\n=== ${fullName} 列信息 ===`)
      const colsRes = await client.query(
        `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `,
        [table_schema, table_name]
      )
      for (const c of colsRes.rows) {
        console.log(`  ${c.column_name}: ${c.data_type} ${c.is_nullable === 'NO' ? 'NOT NULL' : ''}`)
      }
      const quotedSchema = `"${table_schema.replace(/"/g, '""')}"`
      const quotedTable = `"${table_name.replace(/"/g, '""')}"`
      const countRes = await client.query(
        `SELECT COUNT(*) as c FROM ${quotedSchema}.${quotedTable}`
      )
      const count = Number(countRes.rows[0]?.c ?? 0)
      console.log(`  行数: ${count}`)
      if (count > 0) {
        const sampleRes = await client.query(
          `SELECT * FROM ${quotedSchema}.${quotedTable} LIMIT 3`
        )
        console.log('  样例行:')
        console.log(JSON.stringify(sampleRes.rows, null, 2))
      }
    }
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
