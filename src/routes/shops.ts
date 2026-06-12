// @ts-nocheck
import { Router } from 'express';
import { getPool } from '../db.js';
import { getShopById } from '../db/shopsDb.js';
import { assertShopOwnerByUserId, createShopFundApplication, listShopFundApplicationsByShop, } from '../db/shopFundApplicationsDb.js';
import { deleteStorageObjectIfOurs } from './upload.js';
import { parseShopLevelInput, resolveShopLevelFromSales, repriceShopProductsForLevel, syncShopLevelFromSales, } from '../db/shopLevel.js';
export const shopsRouter = Router();
shopsRouter.get('/', async (req, res) => {
    try {
        const shopId = req.query.shop;
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
        const pool = getPool();
        const params = [];
        let where = 'WHERE 1=1';
        if (shopId) {
            params.push(shopId);
            where += ` AND s.id = $${params.length}`;
        }
        if (search.length > 0) {
            params.push(`%${search}%`);
            where += ` AND (s.id ILIKE $${params.length} OR s.name ILIKE $${params.length}) AND s.status = 'normal'`;
        }
        const sql = `
      SELECT
        s.id,
        s.name,
        s.owner_id,
        u.account AS owner_account,
        s.logo,
        s.banner,
        s.address,
        s.country,
        s.level,
        COALESCE(s.followers, 0)      AS follow_count,
        COALESCE(s.sales, 0)          AS sales,
        COALESCE(s.good_rate, 0)      AS good_rate,
        COALESCE(s.credit_score, 0)   AS credit_score,
        COALESCE(s.wallet_balance, 0) AS wallet_balance,
        COALESCE(s.visits, 0)         AS visits,
        s.last_login_ip,
        s.last_login_country,
        s.status,
        s.created_at,
        COALESCE(sp.listed_count, 0)  AS listed_count
      FROM shops s
      LEFT JOIN users u ON u.id = s.owner_id
      LEFT JOIN (
        SELECT shop_id, COUNT(*) AS listed_count
        FROM shop_products
        WHERE status = 'on'
        GROUP BY shop_id
      ) sp ON sp.shop_id = s.id
      ${where}
      ORDER BY s.created_at DESC
    `;
        const result = await pool.query(sql, params);
        const levelLabel = (lvl) => {
            if (lvl == null)
                return '普通';
            if (lvl >= 4)
                return '钻石';
            if (lvl >= 3)
                return '金牌';
            if (lvl >= 2)
                return '银牌';
            return '普通';
        };
        const list = result.rows.map((row) => ({
            id: row.id,
            name: row.name,
            ownerId: row.owner_id,
            ownerAccount: row.owner_account ?? '',
            logo: row.logo ?? null,
            banner: row.banner ?? null,
            address: row.address ?? null,
            country: row.country ?? null,
            level: levelLabel(row.level),
            listedCount: Number(row.listed_count ?? 0),
            followCount: Number(row.follow_count ?? 0),
            sales: Number(row.sales ?? 0),
            goodRate: Number(row.good_rate ?? 0),
            creditScore: Number(row.credit_score ?? 0),
            walletBalance: Number(row.wallet_balance ?? 0),
            visits: Number(row.visits ?? 0),
            lastLoginIp: row.last_login_ip ?? null,
            lastLoginCountry: row.last_login_country ?? null,
            status: row.status ?? 'normal',
            createdAt: row.created_at,
        }));
        res.json({ list });
    }
    catch (e) {
        console.error('[shops list]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
shopsRouter.get('/:id', async (req, res) => {
    try {
        const shop = await getShopById(req.params.id);
        if (!shop) {
            res.status(404).json({ success: false, message: '店铺不存在' });
            return;
        }
        const pool = getPool();
        const syncedLevel = await syncShopLevelFromSales(pool, req.params.id);
        if (syncedLevel != null) {
            shop.level = syncedLevel;
        }
        const countRes = await pool.query('SELECT count(*)::text AS count FROM shop_products WHERE shop_id = $1 AND status = $2', [req.params.id, 'on']);
        const productCount = parseInt(countRes.rows[0]?.count ?? '0', 10);
        res.json({ ...shop, productCount });
    }
    catch (e) {
        console.error('[shops get]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
/** 记录店铺访问量：每次调用则 visits +1，并写入每日访客台账 */
shopsRouter.post('/:id/visit', async (req, res) => {
    try {
        const { recordOrganicShopVisit } = await import('../db/shopVisitSync.js');
        const ok = await recordOrganicShopVisit(req.params.id);
        if (!ok) {
            res.status(404).json({ success: false, message: '店铺不存在' });
            return;
        }
        res.json({ success: true });
    }
    catch (e) {
        console.error('[shops visit]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
/** 店铺推荐商品：有则按推荐表返回，空则随机 2 个在售商品 */
shopsRouter.get('/:id/recommendations', async (req, res) => {
    try {
        const shopId = req.params.id;
        const pool = getPool();
        let recRes = { rows: [] };
        try {
            recRes = await pool.query(`SELECT listing_id, sort_order FROM shop_recommendations WHERE shop_id = $1 ORDER BY sort_order ASC, created_at ASC`, [shopId]);
        }
        catch (tblErr) {
            const code = tblErr?.code;
            if (code === '42P01') {
                console.warn('[shops recommendations] shop_recommendations 表不存在，请执行迁移: node scripts/run-migration.js 010');
            }
            else {
                throw tblErr;
            }
        }
        if (recRes.rows.length > 0) {
            const listingIds = recRes.rows.map((r) => r.listing_id);
            const prodRes = await pool.query(`SELECT sp.id AS listing_id, sp.product_id, sp.price AS listing_price,
                p.product_name, p.main_images, p.selling_price AS product_price, sr.sort_order
         FROM shop_recommendations sr
         JOIN shop_products sp ON sp.shop_id = sr.shop_id AND sp.id::text = sr.listing_id AND sp.status = 'on'
         JOIN products p ON p.product_id = sp.product_id
         WHERE sr.shop_id = $1
         ORDER BY sr.sort_order ASC, sr.created_at ASC`, [shopId]);
            const list = prodRes.rows.map((r) => {
                const mainImages = r.main_images ?? [];
                const img = Array.isArray(mainImages) && mainImages[0] ? String(mainImages[0]) : '';
                const price = r.listing_price != null ? Number(r.listing_price) : Number(r.product_price ?? 0);
                return {
                    listingId: String(r.listing_id),
                    productId: String(r.product_id),
                    title: String(r.product_name ?? ''),
                    image: img,
                    price,
                };
            });
            res.json({ list });
            return;
        }
        const randRes = await pool.query(`SELECT sp.id AS listing_id, sp.product_id, sp.price AS listing_price,
              p.product_name, p.main_images, p.selling_price AS product_price
       FROM shop_products sp
       JOIN products p ON p.product_id = sp.product_id
       WHERE sp.shop_id = $1 AND sp.status = 'on'
       ORDER BY random() LIMIT 2`, [shopId]);
        const list = randRes.rows.map((r) => {
            const mainImages = r.main_images ?? [];
            const img = Array.isArray(mainImages) && mainImages[0] ? String(mainImages[0]) : '';
            const price = r.listing_price != null ? Number(r.listing_price) : Number(r.product_price ?? 0);
            return {
                listingId: String(r.listing_id),
                productId: String(r.product_id),
                title: String(r.product_name ?? ''),
                image: img,
                price,
            };
        });
        res.json({ list });
    }
    catch (e) {
        console.error('[shops recommendations]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
// 店铺交易密码：查询是否已设置（仅店铺所有者可查）
shopsRouter.get('/:id/trade-password/status', async (req, res) => {
    try {
        const shopId = req.params.id;
        const userId = typeof req.query.userId === 'string' ? String(req.query.userId).trim() : '';
        if (!userId) {
            res.status(400).json({ success: false, message: '缺少用户信息' });
            return;
        }
        const auth = await assertShopOwnerByUserId(shopId, userId);
        if (!auth.ok) {
            res.status(403).json({ success: false, message: auth.message ?? '无权限' });
            return;
        }
        const pool = getPool();
        const r = await pool.query('SELECT trade_password FROM shops WHERE id = $1', [shopId]);
        const pwd = r.rows[0]?.trade_password ?? '';
        res.json({ hasTradePassword: !!(pwd && pwd.length > 0) });
    }
    catch (e) {
        console.error('[shops trade-password status]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
// 店铺交易密码：首次设置
shopsRouter.post('/:id/trade-password/set', async (req, res) => {
    try {
        const shopId = req.params.id;
        const body = req.body;
        const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
        const newPwd = typeof body.newTradePassword === 'string' ? body.newTradePassword.trim() : '';
        if (!userId) {
            res.status(400).json({ success: false, message: '缺少用户信息' });
            return;
        }
        const auth = await assertShopOwnerByUserId(shopId, userId);
        if (!auth.ok) {
            res.status(403).json({ success: false, message: auth.message ?? '无权限' });
            return;
        }
        const pinRegex = /^\d{6}$/;
        if (!pinRegex.test(newPwd)) {
            res.status(400).json({ success: false, message: '交易密码需为 6 位数字' });
            return;
        }
        const pool = getPool();
        const r = await pool.query('SELECT trade_password FROM shops WHERE id = $1', [shopId]);
        const existing = r.rows[0]?.trade_password ?? '';
        if (existing && existing.length > 0) {
            res.status(400).json({ success: false, message: '已设置过交易密码，请使用修改功能' });
            return;
        }
        await pool.query('UPDATE shops SET trade_password = $1 WHERE id = $2', [newPwd, shopId]);
        res.json({ success: true });
    }
    catch (e) {
        console.error('[shops trade-password set]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
// 店铺交易密码：修改
shopsRouter.post('/:id/trade-password/change', async (req, res) => {
    try {
        const shopId = req.params.id;
        const body = req.body;
        const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
        const oldPwd = typeof body.oldTradePassword === 'string' ? body.oldTradePassword.trim() : '';
        const newPwd = typeof body.newTradePassword === 'string' ? body.newTradePassword.trim() : '';
        if (!userId) {
            res.status(400).json({ success: false, message: '缺少用户信息' });
            return;
        }
        const auth = await assertShopOwnerByUserId(shopId, userId);
        if (!auth.ok) {
            res.status(403).json({ success: false, message: auth.message ?? '无权限' });
            return;
        }
        const pinRegex = /^\d{6}$/;
        if (!pinRegex.test(newPwd)) {
            res.status(400).json({ success: false, message: '交易密码需为 6 位数字' });
            return;
        }
        const pool = getPool();
        const r = await pool.query('SELECT trade_password FROM shops WHERE id = $1', [shopId]);
        const existing = r.rows[0]?.trade_password ?? '';
        if (!existing) {
            res.status(400).json({ success: false, message: '尚未设置交易密码，请先设置' });
            return;
        }
        if (!oldPwd || oldPwd !== existing) {
            res.status(400).json({ success: false, message: '旧交易密码错误' });
            return;
        }
        await pool.query('UPDATE shops SET trade_password = $1 WHERE id = $2', [newPwd, shopId]);
        res.json({ success: true });
    }
    catch (e) {
        console.error('[shops trade-password change]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
/** 添加推荐：商家在「我的商品」中点击点赞 */
shopsRouter.post('/:id/recommendations', async (req, res) => {
    try {
        const shopId = req.params.id;
        const body = req.body;
        const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
        const listingId = typeof body.listingId === 'string' ? body.listingId.trim() : '';
        if (!userId) {
            res.status(400).json({ success: false, message: '缺少用户信息' });
            return;
        }
        if (!listingId) {
            res.status(400).json({ success: false, message: '缺少 listingId' });
            return;
        }
        const auth = await assertShopOwnerByUserId(shopId, userId);
        if (!auth.ok) {
            res.status(403).json({ success: false, message: auth.message ?? '无权限' });
            return;
        }
        const pool = getPool();
        await pool.query(`INSERT INTO shop_recommendations (shop_id, listing_id) VALUES ($1, $2)
       ON CONFLICT (shop_id, listing_id) DO NOTHING`, [shopId, listingId]);
        res.status(201).json({ success: true });
    }
    catch (e) {
        console.error('[shops POST recommendations]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
/** 取消推荐 */
shopsRouter.delete('/:id/recommendations/:listingId', async (req, res) => {
    try {
        const shopId = req.params.id;
        const listingId = req.params.listingId;
        const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
        if (!userId) {
            res.status(400).json({ success: false, message: '缺少用户信息' });
            return;
        }
        const auth = await assertShopOwnerByUserId(shopId, userId);
        if (!auth.ok) {
            res.status(403).json({ success: false, message: auth.message ?? '无权限' });
            return;
        }
        const pool = getPool();
        await pool.query('DELETE FROM shop_recommendations WHERE shop_id = $1 AND listing_id = $2', [shopId, listingId]);
        res.json({ success: true });
    }
    catch (e) {
        console.error('[shops DELETE recommendations]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
/** 店铺所有在售商品（商城店铺页「所有产品」tab） */
shopsRouter.get('/:id/products', async (req, res) => {
    try {
        const shopId = req.params.id;
        const pool = getPool();
        const r = await pool.query(`SELECT sp.id AS listing_id, sp.product_id, sp.price AS listing_price,
              p.product_name, p.main_images, p.selling_price AS product_price
       FROM shop_products sp
       JOIN products p ON p.product_id = sp.product_id
       WHERE sp.shop_id = $1 AND sp.status = 'on'
       ORDER BY sp.listed_at DESC`, [shopId]);
        const list = r.rows.map((row) => {
            const mainImages = row.main_images ?? [];
            const img = Array.isArray(mainImages) && mainImages[0] ? String(mainImages[0]) : '';
            const price = row.listing_price != null ? Number(row.listing_price) : Number(row.product_price ?? 0);
            return {
                listingId: String(row.listing_id),
                productId: String(row.product_id),
                title: String(row.product_name ?? ''),
                image: img,
                price,
            };
        });
        res.json({ list });
    }
    catch (e) {
        console.error('[shops products]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
// ---------- 店铺钱包：充值/提现提交 + 申请记录 ----------
shopsRouter.get('/:id/fund-applications', async (req, res) => {
    try {
        const shopId = req.params.id;
        const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
        if (userId) {
            const auth = await assertShopOwnerByUserId(shopId, userId);
            if (!auth.ok) {
                res.status(403).json({ success: false, message: auth.message ?? '无权限' });
                return;
            }
        }
        const status = req.query.status === 'pending' || req.query.status === 'approved' || req.query.status === 'rejected'
            ? req.query.status
            : undefined;
        const type = req.query.type === 'recharge' || req.query.type === 'withdraw'
            ? req.query.type
            : undefined;
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
        const { list, total } = await listShopFundApplicationsByShop({ shopId, status, type, page, pageSize });
        res.json({ list, total, page, pageSize });
    }
    catch (e) {
        console.error('[shops fund-applications]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
// 店铺钱包充值申请：校验店铺交易密码后提交，由后台审核通过后入账
shopsRouter.post('/:id/recharge', async (req, res) => {
    try {
        const shopId = req.params.id;
        const body = req.body;
        const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
        const tradePassword = typeof body.tradePassword === 'string' ? body.tradePassword.trim() : '';
        const rechargeScreenshotUrl = typeof body.rechargeScreenshotUrl === 'string' ? body.rechargeScreenshotUrl.trim() : '';
        const amount = Number(body.amount);
        if (!userId) {
            res.status(400).json({ success: false, message: '缺少用户信息' });
            return;
        }
        const auth = await assertShopOwnerByUserId(shopId, userId);
        if (!auth.ok) {
            res.status(403).json({ success: false, message: auth.message ?? '无权限' });
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            res.status(400).json({ success: false, message: '请输入正确的金额' });
            return;
        }
        if (!rechargeScreenshotUrl) {
            res.status(400).json({ success: false, message: '请上传交易截图' });
            return;
        }
        // 使用店铺独立交易密码，而非用户个人交易密码
        const shopRow = await getPool().query('SELECT trade_password FROM shops WHERE id = $1', [shopId]);
        const shopTradePwd = shopRow.rows[0]?.trade_password ?? '';
        if (!shopTradePwd) {
            res.status(400).json({ success: false, message: '请先设置店铺交易密码' });
            return;
        }
        if (!tradePassword || tradePassword !== shopTradePwd) {
            res.status(400).json({ success: false, message: '交易密码错误' });
            return;
        }
        const { id } = await createShopFundApplication({
            shopId,
            type: 'recharge',
            amount,
            rechargeScreenshotUrl,
        });
        res.status(201).json({ success: true, id });
    }
    catch (e) {
        console.error('[shops recharge]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
// 店铺钱包提现申请：校验店铺交易密码后提交，由后台审核通过后扣款
shopsRouter.post('/:id/withdraw', async (req, res) => {
    try {
        const shopId = req.params.id;
        const body = req.body;
        const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
        const tradePassword = typeof body.tradePassword === 'string' ? body.tradePassword.trim() : '';
        const address = typeof body.address === 'string' ? body.address.trim() : '';
        const amount = Number(body.amount);
        if (!userId) {
            res.status(400).json({ success: false, message: '缺少用户信息' });
            return;
        }
        const auth = await assertShopOwnerByUserId(shopId, userId);
        if (!auth.ok) {
            res.status(403).json({ success: false, message: auth.message ?? '无权限' });
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            res.status(400).json({ success: false, message: '请输入正确的金额' });
            return;
        }
        if (!address) {
            res.status(400).json({ success: false, message: '请填写提现地址' });
            return;
        }
        // 使用店铺独立交易密码，而非用户个人交易密码
        const shopPwdRes = await getPool().query('SELECT trade_password FROM shops WHERE id = $1', [shopId]);
        const shopTradePwd = shopPwdRes.rows[0]?.trade_password ?? '';
        if (!shopTradePwd) {
            res.status(400).json({ success: false, message: '请先设置店铺交易密码' });
            return;
        }
        if (!tradePassword || tradePassword !== shopTradePwd) {
            res.status(400).json({ success: false, message: '交易密码错误' });
            return;
        }
        const shop = await getShopById(shopId);
        if (!shop) {
            res.status(404).json({ success: false, message: '店铺不存在' });
            return;
        }
        if (shop.walletBalance < amount) {
            res.status(400).json({ success: false, message: '余额不足' });
            return;
        }
        const { id } = await createShopFundApplication({
            shopId,
            type: 'withdraw',
            amount,
            withdrawAddress: address,
        });
        res.status(201).json({ success: true, id });
    }
    catch (e) {
        console.error('[shops withdraw]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
// ---------- 店铺财务报表：资金流水 + 收入/支出汇总 ----------
shopsRouter.get('/:id/finance', async (req, res) => {
    try {
        const shopId = req.params.id;
        const daysParam = typeof req.query.days === 'string' ? req.query.days.trim() : '';
        let days = Number(daysParam || '30');
        if (!Number.isFinite(days) || days <= 0)
            days = 30;
        if (days > 365)
            days = 365;
        const pool = getPool();
        // 查询资金流水（按时间范围过滤）
        const logsRes = await pool.query(`SELECT id, shop_id, type, amount::text AS amount, balance_after::text AS balance_after,
              remark, order_code, created_at
       FROM shop_fund_logs
       WHERE shop_id = $1
         AND created_at >= NOW() - ($2::int || ' days')::interval
       ORDER BY created_at DESC`, [shopId, days]);
        let incomeTotal = 0;
        let expenseTotal = 0;
        const records = logsRes.rows.map((row) => {
            const amount = Math.round(Number(row.amount ?? 0) * 100) / 100;
            if (amount >= 0)
                incomeTotal += amount;
            else
                expenseTotal += -amount;
            const balanceAfter = row.balance_after != null ? Math.round(Number(row.balance_after) * 100) / 100 : null;
            return {
                id: String(row.id),
                type: row.type,
                amount,
                balanceAfter,
                remark: row.remark ?? '',
                orderNo: row.order_code ?? '',
                createdAt: row.created_at,
            };
        });
        const net = Math.round((incomeTotal - expenseTotal) * 100) / 100;
        res.json({
            incomeTotal,
            expenseTotal,
            net,
            days,
            records,
        });
    }
    catch (e) {
        console.error('[shops finance]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
// ---------- 店铺仪表盘：概要统计 + 近 7 日订单趋势 ----------
shopsRouter.get('/:id/dashboard', async (req, res) => {
    try {
        const shopId = req.params.id;
        const pool = getPool();
        const { syncShopPromotionVisits, getShopVisitSummary } = await import('../db/shopVisitSync.js');
        await syncShopPromotionVisits(shopId);
        // 1. 店铺基础信息
        const shopRes = await pool.query(`SELECT level, credit_score, followers, sales, good_rate, visits
       FROM shops
       WHERE id = $1`, [shopId]);
        if (shopRes.rows.length === 0) {
            res.status(404).json({ success: false, message: '店铺不存在' });
            return;
        }
        const s = shopRes.rows[0];
        let shopLevel = Number(s.level ?? 1);
        const creditScore = Number(s.credit_score ?? 0);
        const goodRate = Number(s.good_rate ?? 0);
        const followers = Number(s.followers ?? 0);
        const salesTotal = Number(s.sales ?? 0);
        const syncedLevel = await syncShopLevelFromSales(pool, shopId);
        if (syncedLevel != null) {
            shopLevel = syncedLevel;
        }
        let visitSummary = {
            visitsTotal: Number(s.visits ?? 0),
            visitsToday: 0,
            visits7d: 0,
            visits30d: 0,
            visitTrend: { labels: [], daily: [] },
        };
        try {
            visitSummary = await getShopVisitSummary(shopId);
        }
        catch (visitSummaryErr) {
            console.warn('[shops dashboard] visit summary unavailable', visitSummaryErr);
            visitSummary.visitsTotal = Number(s.visits ?? 0);
        }
        const visitsTotal = visitSummary.visitsTotal;
        // 2. 商品总数（在售）
        const prodRes = await pool.query(`SELECT count(*)::text AS count
       FROM shop_products
       WHERE shop_id = $1 AND status = 'on'`, [shopId]);
        const productCount = parseInt(prodRes.rows[0]?.count ?? '0', 10);
        // 3. 订单汇总 & 今日概况（买家已付款订单计入销售额；总利润仅含已完全结算订单）
        const buyerPaidFilter = `status NOT IN ('pending', 'cancelled', 'refunded')`;
        const ordersAggRes = await pool.query(`SELECT
         count(*)::text AS total_orders,
         COALESCE(SUM(CASE WHEN ${buyerPaidFilter} THEN total_amount ELSE 0 END), 0)::text AS total_amount,
         COALESCE(SUM(
           CASE
             WHEN status = 'completed' AND revenue_paid_at IS NOT NULL THEN profit_amount
             ELSE 0
           END
         ), 0)::text AS total_profit
       FROM orders
       WHERE shop_id = $1`, [shopId]);
        const oa = ordersAggRes.rows[0];
        const orderCount = parseInt(oa?.total_orders ?? '0', 10);
        const totalSales = Math.round(Number(oa?.total_amount ?? 0) * 100) / 100;
        const totalProfit = Math.round(Number(oa?.total_profit ?? 0) * 100) / 100;
        // 今日订单与销售（今日下单且买家已付款）
        const todayAggRes = await pool.query(`SELECT
         count(*)::text AS today_orders,
         COALESCE(SUM(total_amount), 0)::text AS today_amount
       FROM orders
       WHERE shop_id = $1
         AND created_at::date = CURRENT_DATE
         AND ${buyerPaidFilter}`, [shopId]);
        const ta = todayAggRes.rows[0];
        const todayOrders = parseInt(ta?.today_orders ?? '0', 10);
        const todaySales = Math.round(Number(ta?.today_amount ?? 0) * 100) / 100;
        // 预计利润：尚未完全结算订单的利润总和（已发货用 profit_amount，待发货按订单金额减采购成本估算）
        const expectedProfitRes = await pool.query(`WITH unsettled AS (
         SELECT o.id, o.total_amount, o.profit_amount, o.procurement_total
         FROM orders o
         WHERE o.shop_id = $1
           AND o.status NOT IN ('cancelled', 'refunded', 'pending')
           AND (o.status <> 'completed' OR o.revenue_paid_at IS NULL)
       ),
       proc AS (
         SELECT oi.order_id,
           COALESCE(SUM(oi.quantity * COALESCE(p.purchase_price, p.selling_price, oi.unit_price, 0)), 0) AS cost
         FROM order_items oi
         LEFT JOIN products p ON p.product_id = oi.product_id
         WHERE oi.order_id IN (SELECT id FROM unsettled)
         GROUP BY oi.order_id
       )
       SELECT COALESCE(SUM(
         CASE
           WHEN COALESCE(u.profit_amount, 0) > 0 THEN u.profit_amount
           ELSE GREATEST(
             0,
             COALESCE(u.total_amount, 0) - COALESCE(NULLIF(u.procurement_total, 0), pr.cost, 0)
           )
         END
       ), 0)::text AS expected_profit
       FROM unsettled u
       LEFT JOIN proc pr ON pr.order_id = u.id`, [shopId]);
        const expectedProfit = Math.round(Number(expectedProfitRes.rows[0]?.expected_profit ?? 0) * 100) / 100;
        // 4. 待处理订单：买家已付款，但店铺还未完成发货采购（status = 'paid'）
        const pendingOrdersRes = await pool.query(`SELECT count(*)::text AS count
       FROM orders
       WHERE shop_id = $1
         AND status = 'paid'`, [shopId]);
        const pendingOrders = parseInt(pendingOrdersRes.rows[0]?.count ?? '0', 10);
        // 5. 待结算金额：预计未来会回款但尚未入账的钱
        const unsettledRes = await pool.query(`SELECT COALESCE(SUM(COALESCE(revenue_amount, total_amount)), 0)::text AS amount
       FROM orders
       WHERE shop_id = $1
         AND status NOT IN ('cancelled', 'refunded')
         AND (status <> 'completed' OR revenue_paid_at IS NULL)`, [shopId]);
        const unsettledAmount = Math.round(Number(unsettledRes.rows[0]?.amount ?? 0) * 100) / 100;
        // 6. 近 7 日订单趋势（按日期聚合）
        const trendRes = await pool.query(`SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day,
              count(*)::text AS order_count,
              COALESCE(SUM(total_amount), 0)::text AS sales_amount
       FROM orders
       WHERE shop_id = $1
         AND created_at::date >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY created_at::date
       ORDER BY day`, [shopId]);
        const trendMap = new Map();
        for (const row of trendRes.rows) {
            const cnt = parseInt(row.order_count ?? '0', 10);
            const sales = Math.round(Number(row.sales_amount ?? 0) * 100) / 100;
            trendMap.set(row.day, {
                orders: Number.isFinite(cnt) ? cnt : 0,
                sales: Number.isFinite(sales) ? sales : 0,
            });
        }
        const today = new Date();
        const dayLabels = [];
        const ordersSeries = [];
        const salesSeries = [];
        const weekdayMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        for (let i = 6; i >= 0; i -= 1) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const key = `${y}-${m}-${day}`;
            const point = trendMap.get(key) ?? { orders: 0, sales: 0 };
            dayLabels.push(weekdayMap[d.getDay()]);
            ordersSeries.push(point.orders);
            salesSeries.push(point.sales);
        }
        const followerTrendMap = new Map();
        try {
            const followerTrendRes = await pool.query(`SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day,
              count(*)::text AS follower_count
       FROM user_followed_shops
       WHERE shop_id = $1
         AND created_at::date >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY created_at::date
       ORDER BY day`, [shopId]);
            for (const row of followerTrendRes.rows) {
                const cnt = parseInt(row.follower_count ?? '0', 10);
                followerTrendMap.set(row.day, Number.isFinite(cnt) ? cnt : 0);
            }
        }
        catch (followerTrendErr) {
            console.warn('[shops dashboard] follower trend unavailable', followerTrendErr);
        }
        const followersDailySeries = [];
        for (let i = 6; i >= 0; i -= 1) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const key = `${y}-${m}-${day}`;
            followersDailySeries.push(followerTrendMap.get(key) ?? 0);
        }
        res.json({
            productCount,
            totalSales,
            orderCount,
            totalProfit,
            pendingOrders,
            unsettledAmount,
            shopLevel,
            shopSalesTotal: salesTotal,
            creditScore,
            goodRate,
            followers,
            visitsTotal,
            visitsToday: visitSummary.visitsToday,
            visits7d: visitSummary.visits7d,
            visits30d: visitSummary.visits30d,
            todayOrders,
            todaySales,
            expectedProfit,
            orderTrend: {
                labels: dayLabels,
                orders: ordersSeries,
                sales: salesSeries,
            },
            followerTrend: {
                labels: dayLabels,
                daily: followersDailySeries,
            },
            visitTrend: visitSummary.visitTrend,
        });
    }
    catch (e) {
        console.error('[shops dashboard]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
shopsRouter.patch('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const body = req.body;
        const pool = getPool();
        const fields = [];
        const values = [];
        let i = 1;
        if (body.logo !== undefined || body.banner !== undefined) {
            const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
            if (!userId) {
                res.status(400).json({ success: false, message: '修改店铺头像或横幅需提供 userId' });
                return;
            }
            const auth = await assertShopOwnerByUserId(id, userId);
            if (!auth.ok) {
                res.status(403).json({ success: false, message: auth.message ?? '无权限' });
                return;
            }
            const existing = await getShopById(id);
            if (body.logo !== undefined && existing?.logo) {
                await deleteStorageObjectIfOurs(existing.logo);
            }
            if (body.banner !== undefined && existing?.banner) {
                await deleteStorageObjectIfOurs(existing.banner);
            }
        }
        if (body.logo !== undefined) {
            fields.push(`logo = $${i++}`);
            values.push(body.logo === null || body.logo === '' ? null : String(body.logo));
        }
        if (body.banner !== undefined) {
            fields.push(`banner = $${i++}`);
            values.push(body.banner === null || body.banner === '' ? null : String(body.banner));
        }
        const touchesLevelPolicy = (body.level !== undefined && body.level !== null) ||
            typeof body.sales === 'number' ||
            body.levelAutoUnlock === true;
        let repriceLevel = null;
        if (touchesLevelPolicy) {
            const levelStateRes = await pool.query(`SELECT level, sales, COALESCE(level_locked, false) AS level_locked
         FROM shops WHERE id = $1`, [id]);
            if (levelStateRes.rows.length === 0) {
                res.status(404).json({ success: false, message: '店铺不存在' });
                return;
            }
            const levelState = levelStateRes.rows[0];
            const previousLevel = Number(levelState.level ?? 1);
            let nextLevel = previousLevel;
            let nextLocked = Boolean(levelState.level_locked);
            let nextSales = Number(levelState.sales ?? 0);
            const manualLevel = parseShopLevelInput(body.level);
            if (manualLevel != null) {
                nextLevel = manualLevel;
                nextLocked = manualLevel !== resolveShopLevelFromSales(nextSales);
            }
            if (body.levelAutoUnlock === true) {
                nextLocked = false;
            }
            if (typeof body.sales === 'number') {
                nextSales = Math.max(0, body.sales);
            }
            if (!nextLocked) {
                nextLevel = resolveShopLevelFromSales(nextSales);
            }
            fields.push(`level = $${i++}`);
            values.push(nextLevel);
            fields.push(`level_locked = $${i++}`);
            values.push(nextLocked);
            fields.push(`sales = $${i++}`);
            values.push(nextSales);
            if (nextLevel !== previousLevel) {
                repriceLevel = nextLevel;
            }
        }
        if (typeof body.followCount === 'number') {
            fields.push(`followers = $${i++}`);
            values.push(Math.max(0, body.followCount));
        }
        if (typeof body.goodRate === 'number') {
            fields.push(`good_rate = $${i++}`);
            values.push(Math.min(100, Math.max(0, body.goodRate)));
        }
        if (typeof body.creditScore === 'number') {
            fields.push(`credit_score = $${i++}`);
            values.push(Math.min(100, Math.max(0, body.creditScore)));
        }
        if (typeof body.walletBalance === 'number') {
            fields.push(`wallet_balance = $${i++}`);
            values.push(Math.max(0, body.walletBalance));
        }
        if (typeof body.visits === 'number') {
            fields.push(`visits = $${i++}`);
            values.push(Math.max(0, Math.floor(body.visits)));
        }
        if (body.status === 'normal' || body.status === 'banned') {
            fields.push(`status = $${i++}`);
            values.push(body.status);
        }
        if (fields.length === 0) {
            res.json({ success: true });
            return;
        }
        values.push(id);
        const sql = `UPDATE shops SET ${fields.join(', ')} WHERE id = $${i}`;
        const result = await pool.query(sql, values);
        if ((result.rowCount ?? 0) === 0) {
            res.status(404).json({ success: false, message: '店铺不存在' });
            return;
        }
        if (repriceLevel != null) {
            await repriceShopProductsForLevel(pool, id, repriceLevel);
        }
        res.json({ success: true });
    }
    catch (e) {
        console.error('[shops patch]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
