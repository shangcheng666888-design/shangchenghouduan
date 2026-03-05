import 'dotenv/config'
import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const name = process.argv[2] || '004'
const files = {
  '003': '003_users.sql',
  '004': '004_user_fund_logs_and_bot_flag.sql',
  '005': '005_user_fund_applications.sql',
  '006': '006_user_favorites_and_followed_shops.sql',
  '007': '007_shop_applications_and_shops.sql',
  '008': '008_products_supply_status.sql',
  '009': '009_products_purchase_price.sql',
  '010': '010_shop_recommendations.sql',
  '011': '011_users_avatar.sql',
  '012': '012_orders_timestamp_columns.sql',
  '013': '013_orders_settlement_columns.sql',
  '014': '014_platform_payment_config.sql',
  '015': '015_mall_home_featured.sql',
  '016': '016_user_cart.sql',
}
const fileName = files[name] || (name.endsWith('.sql') ? name : `${name}.sql`)
const sqlPath = path.join(__dirname, '../migrations', fileName)
const sql = fs.readFileSync(sqlPath, 'utf8')

if (!process.env.DB_DSN) {
  console.error('DB_DSN 未设置，请在 .env 中配置')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DB_DSN })
try {
  await pool.query(sql)
  console.log('已执行:', path.basename(sqlPath))
} catch (e) {
  console.error('执行失败:', e.message)
  process.exit(1)
} finally {
  await pool.end()
}
