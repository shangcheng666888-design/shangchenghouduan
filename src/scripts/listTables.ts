import 'dotenv/config'
import { Client } from 'pg'

async function main() {
  const dsn = process.env.DB_DSN
  if (!dsn) {
    // eslint-disable-next-line no-console
    console.error('DB_DSN 未配置，无法列出表')
    process.exit(1)
  }
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    const res = await client.query<{
      tablename: string
    }>("select tablename from pg_tables where schemaname = 'public' order by tablename")
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(res.rows, null, 2))
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('列出表失败', err)
  process.exit(1)
})

