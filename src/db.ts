import pg from 'pg'

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) {
    const dsn = process.env.DB_DSN
    if (!dsn) throw new Error('DB_DSN is not set')
    pool = new pg.Pool({ connectionString: dsn })
  }
  return pool
}

export type ProductRow = {
  product_id: string
  goods_id: string | null
  category_id: string | null
  sub_category_id: string | null
  product_name: string | null
  purchase_price: string | null
  selling_price: string | null
  description_html: string | null
  detail_html: string | null
  main_images: string[] | null
}

export type CategoryRow = {
  category_id: string
  parent_id: string | null
  level: number
  name_en: string | null
}
