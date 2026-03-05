import 'dotenv/config'
import { Client } from 'pg'

const dsn = process.env.DB_DSN

if (!dsn) {
  // eslint-disable-next-line no-console
  console.error('DB_DSN 未配置，无法创建充值/提现视图')
  process.exit(1)
}

const sql = `
-- 商城充值视图：一行就是一笔充值申请
create or replace view mall_recharge_orders as
select
  a.id                      as id,              -- 交易ID（申请ID）
  a.user_id                 as user_id,
  a.created_at              as created_at,      -- 日期
  ('R' || lpad(a.id::text, 8, '0')) as order_no, -- 订单号（系统生成）
  a.amount::numeric(18,2)   as amount,          -- 充值金额
  'USDT'::text              as currency,        -- 币种
  'USDT-TRC20'::text        as protocol,        -- 协议
  a.status                  as status,          -- 订单状态 pending/approved/rejected
  a.recharge_tx_no          as tx_no,           -- 用户填写的交易号
  case when a.status = 'approved'
       then a.amount::numeric(18,2)
       else 0::numeric(18,2)
  end                       as actual_amount,   -- 实际到账
  null::text                as deposit_address, -- 充值地址（目前前端固定地址，如需逐笔记录可再加列）
  a.remark                  as remark
from user_fund_applications a
where a.type = 'recharge';

-- 商城提现视图：一行就是一笔提现申请
create or replace view mall_withdraw_orders as
select
  a.id                      as id,              -- 交易ID（申请ID）
  a.user_id                 as user_id,
  a.created_at              as created_at,      -- 日期
  ('W' || lpad(a.id::text, 8, '0')) as order_no, -- 订单号（系统生成）
  a.amount::numeric(18,2)   as amount,          -- 提现金额
  'USDT'::text              as currency,        -- 币种
  a.status                  as status,          -- 订单状态 pending/approved/rejected
  a.withdraw_address        as withdraw_address,-- 提现地址
  a.remark                  as remark
from user_fund_applications a
where a.type = 'withdraw';
`

async function main() {
  const client = new Client({ connectionString: dsn })
  await client.connect()
  try {
    await client.query(sql)
    // eslint-disable-next-line no-console
    console.log('mall_recharge_orders / mall_withdraw_orders 视图已确保存在')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('创建充值/提现视图失败', err)
  process.exit(1)
})

