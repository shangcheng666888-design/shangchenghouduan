import 'dotenv/config'
import { Client } from 'pg'

async function main() {
  const dsn = process.env.DB_DSN
  if (!dsn) {
    console.error('DB_DSN 未配置，无法查询订单数据')
    process.exit(1)
  }

  const client = new Client({ connectionString: dsn })
  await client.connect()

  try {
    const orderRes = await client.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 1')
    if (orderRes.rows.length === 0) {
      console.log('当前数据库中暂无订单记录')
      return
    }
    const order = orderRes.rows[0]
    console.log('最新一条订单（orders 表）：')
    console.log(JSON.stringify(order, null, 2))

    const itemsRes = await client.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC', [order.id])
    console.log('该订单对应的商品明细（order_items 表）：')
    console.log(JSON.stringify(itemsRes.rows, null, 2))
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('查询订单数据失败', err)
  process.exit(1)
})

