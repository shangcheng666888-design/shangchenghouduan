import 'dotenv/config'
import { getPool } from '../db.js'

async function main() {
  const pool = getPool()
  const sql = `
  CREATE TABLE IF NOT EXISTS shop_fund_applications (
    id BIGSERIAL PRIMARY KEY,
    shop_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('recharge', 'withdraw')),
    amount NUMERIC(18,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    recharge_tx_no TEXT,
    withdraw_address TEXT,
    reviewed_at TIMESTAMPTZ,
    reviewer_id TEXT,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_shop_fund_applications_shop_id_created_at
    ON shop_fund_applications (shop_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_shop_fund_applications_status_created_at
    ON shop_fund_applications (status, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_shop_fund_applications_type_created_at
    ON shop_fund_applications (type, created_at DESC);

  CREATE TABLE IF NOT EXISTS shop_fund_logs (
    id BIGSERIAL PRIMARY KEY,
    shop_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('recharge', 'withdraw', 'consume', 'refund')),
    amount NUMERIC(18,2) NOT NULL,
    balance_after NUMERIC(18,2),
    related_id TEXT,
    remark TEXT,
    order_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_fund_logs_order_code
    ON shop_fund_logs (order_code);

  CREATE INDEX IF NOT EXISTS idx_shop_fund_logs_shop_id_created_at
    ON shop_fund_logs (shop_id, created_at DESC);
  `

  await pool.query(sql)
  console.log('[createShopFundTables] done')
  await pool.end()
}

main().catch((e) => {
  console.error('[createShopFundTables] failed', e)
  process.exit(1)
})

