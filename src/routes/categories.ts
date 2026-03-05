import { Router } from 'express'
import { getPool } from '../db.js'

export const categoriesRouter = Router()

const pool = process.env.DB_DSN ? () => getPool() : null

categoriesRouter.get('/', async (_req, res) => {
  if (!pool) {
    res.json({ list: [] })
    return
  }
  try {
    const client = await pool().connect()
    try {
      const r = await client.query(
        'SELECT category_id AS id, parent_id, level, name_en AS name FROM categories ORDER BY level, category_id'
      )
      res.json({ list: r.rows })
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('[categories] db error', e)
    res.status(500).json({ success: false, message: '数据库查询失败' })
  }
})
