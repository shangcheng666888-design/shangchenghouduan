-- 将 shops.sales 从 int 调整为 numeric(18,2)，用于累计销售金额（订单完成回款后累计销售额）
alter table if exists shops
  alter column sales type numeric(18,2) using sales::numeric(18,2);

