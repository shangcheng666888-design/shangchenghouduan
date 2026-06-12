// @ts-nocheck
/** 店铺等级销售额门槛（与商家端 merchantShopLevels 一致） */
export const SHOP_LEVEL_MIN_SALES = {
    1: 0,
    2: 10000,
    3: 50000,
    4: 100000,
};

export function getLevelMarginRate(level) {
    switch (Number(level)) {
        case 2:
            return 0.15;
        case 3:
            return 0.2;
        case 4:
            return 0.25;
        default:
            return 0.1;
    }
}

/** 根据累计销售额计算应有等级 */
export function resolveShopLevelFromSales(sales) {
    const s = Math.max(0, Number(sales) || 0);
    if (s >= SHOP_LEVEL_MIN_SALES[4])
        return 4;
    if (s >= SHOP_LEVEL_MIN_SALES[3])
        return 3;
    if (s >= SHOP_LEVEL_MIN_SALES[2])
        return 2;
    return 1;
}

/** 未锁定时按销售额同步等级；锁定时保留管理员设置的等级 */
export function resolveShopLevelForSales(sales, levelLocked, currentLevel) {
    if (levelLocked) {
        const lv = Number(currentLevel) || 1;
        return Math.max(1, Math.min(4, Math.floor(lv)));
    }
    return resolveShopLevelFromSales(sales);
}

export function parseShopLevelInput(lv) {
    if (lv === undefined || lv === null)
        return null;
    if (typeof lv === 'number' && lv >= 1 && lv <= 4) {
        return Math.floor(lv);
    }
    const s = String(lv).trim();
    if (s === '普通')
        return 1;
    if (s === '银牌')
        return 2;
    if (s === '金牌')
        return 3;
    if (s === '钻石')
        return 4;
    const n = Number(s);
    if (Number.isFinite(n) && n >= 1 && n <= 4) {
        return Math.floor(n);
    }
    return null;
}

export async function repriceShopProductsForLevel(executor, shopId, level) {
    const marginRate = getLevelMarginRate(level);
    await executor.query(`UPDATE shop_products sp
     SET price = ROUND(
       (COALESCE(p.purchase_price::numeric, p.selling_price::numeric, 0) * (1 + $1::numeric))::numeric,
       2
     )
     FROM products p
     WHERE p.product_id = sp.product_id
       AND sp.shop_id = $2
       AND sp.status = 'on'
       AND COALESCE(p.purchase_price::numeric, p.selling_price::numeric, 0) > 0`, [marginRate, shopId]);
}

/** 将店铺等级与销售额对齐（未锁定店铺） */
export async function syncShopLevelFromSales(executor, shopId) {
    const res = await executor.query(`SELECT level, sales, COALESCE(level_locked, false) AS level_locked
     FROM shops
     WHERE id = $1`, [shopId]);
    if (res.rows.length === 0)
        return null;
    const row = res.rows[0];
    const currentLevel = Number(row.level ?? 1);
    if (row.level_locked) {
        return currentLevel;
    }
    const sales = Number(row.sales ?? 0);
    const nextLevel = resolveShopLevelFromSales(sales);
    if (nextLevel === currentLevel) {
        return currentLevel;
    }
    await executor.query('UPDATE shops SET level = $1 WHERE id = $2', [nextLevel, shopId]);
    await repriceShopProductsForLevel(executor, shopId, nextLevel);
    return nextLevel;
}
