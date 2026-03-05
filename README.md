# 商城后端 API

Node.js + Express + TypeScript，为前端提供 REST 接口。

- **商品数据**：配置 `DB_DSN` 后从 PostgreSQL（Supabase）读取 `products`、`product_skus`、`categories` 等表；图片 URL 已存在库中（Supabase 存储桶 `commodity`）。
- **用户**：已持久化到 PostgreSQL。需执行 `migrations/003_users.sql` 建表；登录、注册、用户列表、下单扣款均读写数据库，长期运行依赖此表。
- **店铺/订单/审核**：仍使用内存存储，后续可迁到数据库。
- **余额与钱包为两套独立体系**：**用户 balance** = 商城客户（买家）余额，用于下单、充值、提现；**店铺 walletBalance** = 店铺钱包余额，用于收款、提现；二者互不影响。

## 启动

```bash
cd backend
cp .env.example .env   # 首次：复制并填入真实配置
npm install
npm run dev
```

默认端口 **3001**，可通过环境变量 `PORT` 修改。

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `DB_DSN` | PostgreSQL 连接串（Supabase 可在项目 Settings → Database 中获取） | **必填**（商品 + 用户均依赖） |
| `SUPABASE_URL` | Supabase 项目 URL | 存储相关时 |
| `SUPABASE_KEY` | Supabase service_role 或 anon key | 存储相关时 |
| `BUCKET` | 存储桶名称（如商品图 `commodity`） | 可选 |
| `PORT` | 服务端口 | 默认 3001 |
| `ADMIN_USER` / `ADMIN_PASS` / `ADMIN_GOOGLE_TOTP` | 管理后台登录 | 可选，有默认值 |

**注意**：`.env` 含敏感信息，已加入 `.gitignore`，请勿提交。

## 接口一览

- `GET /api/health` — 健康检查
- **买家**
  - `POST /api/auth/login` — 登录（body: `type`, `value`, `password`）
  - `POST /api/auth/register` — 注册（body: `account`, `password`）
- **管理后台**
  - `POST /api/admin/auth/login` — 管理员登录（body: `username`, `password`, `googleToken`）
- **用户管理**（用户余额 = 买家 balance，独立于店铺钱包）
  - `GET /api/users` — 用户列表（含 `balance` 用户余额）
  - `GET /api/users/:id` — 用户详情
  - `PATCH /api/users/:id` — 更新用户（可传 `balance`）
- **店铺**（店铺钱包 = walletBalance，独立于用户余额）
  - `GET /api/shops` — 店铺列表（含 `walletBalance` 店铺钱包余额）
  - `GET /api/shops/:id` — 店铺详情
  - `PATCH /api/shops/:id` — 更新店铺（可传 `walletBalance`）
- **商品**（有 `DB_DSN` 时从 PostgreSQL 读）
  - **商城站**：按「上架记录」展示，**同一商品多店会多条、定价可不同**；每条有独立 `id`（listingId）。
  - `GET /api/products` — 商城站列表（每条：`id`=listingId、`shopId`、`productId`、`price` 店铺价或商品默认价、分类等）
  - `GET /api/products/:id` — 按商品 product_id 的详情（未上架 404）
  - `GET /api/products/supply` — 供货列表（全部商品，供店铺采购；query: `limit`, `offset`, `categoryId`）
  - `POST /api/products` — 新增商品（仍写内存）
  - `PATCH /api/products/:id` — 更新（仅内存）
- **上架记录**（每条「某店卖某品」有独立 ID，用于详情与下单）
  - `GET /api/listings/:listingId` — 按上架记录 ID 查详情（该店该价、商品信息）
- **用户表**（长期运行必做）：执行 `migrations/003_users.sql` 创建 `users` 表；未执行则登录/注册会报错。
- **店铺上架**（需执行 `migrations/001_shop_products.sql`、`002_...listing_id_and_price.sql`）
  - `POST /api/shop-products` — 上架（body: `shopId`, `productId`, 可选 `price`；返回 `listingId`）
  - `DELETE /api/shop-products/:shopId/:productId` — 下架
  - `GET /api/shop-products/by-shop/:shopId` — 某店铺已上架列表（含 `listingId`、`price`）
- **分类**（有 `DB_DSN` 时从 PostgreSQL 读）
  - `GET /api/categories` — 分类列表（id, parent_id, level, name）
- **订单**
  - `GET /api/orders` — 订单列表（query: `shop` 可选）
  - `GET /api/orders/:id` — 订单详情
  - `POST /api/orders` — 创建订单
  - `PATCH /api/orders/:id` — 更新订单
- **审核**
  - `GET /api/audit/shops` — 待审核店铺入驻列表
  - `GET /api/audit/shops/:id` — 入驻申请详情
  - `POST /api/audit/shops/:id/approve` — 通过
  - `POST /api/audit/shops/:id/reject` — 拒绝

## 种子数据

- 买家账号：执行 `003_users.sql` 后会插入 `U10001` / `buyer@test.com` / 密码 `abc123` / 余额 1000（若已存在则跳过）。
- 管理员：`admin` / `admin123` / 谷歌令牌 `123456`（仍为内存）。

## 前端联调

前端在 `.env.development` 中配置 `VITE_API_URL=http://localhost:3001`，请求会发往后端。先启动后端，再启动前端（`npm run dev`）。
