// @ts-nocheck
import { getPool } from '../db.js';
import { getReleasedMetricsFromPlan } from './paidPromotionSchedule.js';

async function getPromotionById(id) {
    const { getPromotionById: loadPromotion } = await import('./paidPromotionsDb.js');
    return loadPromotion(id);
}

function toDateKey(value) {
    if (value instanceof Date)
        return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

export async function recordOrganicShopVisit(shopId) {
    const pool = getPool();
    const today = new Date().toISOString().slice(0, 10);
    const shopRes = await pool.query('UPDATE shops SET visits = COALESCE(visits, 0) + 1 WHERE id = $1 RETURNING id', [shopId]);
    if ((shopRes.rowCount ?? 0) === 0)
        return false;
    await pool.query(`INSERT INTO shop_daily_visits (shop_id, visit_date, organic_visits, promotion_visits)
     VALUES ($1, $2::date, 1, 0)
     ON CONFLICT (shop_id, visit_date)
     DO UPDATE SET organic_visits = shop_daily_visits.organic_visits + 1`, [shopId, today]);
    return true;
}

export async function syncPromotionVisitsToShop(promotion) {
    if (!promotion?.shopId || !promotion.campaignStartAt)
        return 0;
    if (!['active', 'completed'].includes(promotion.status))
        return 0;
    const pool = getPool();
    const planRes = await pool.query(`SELECT id, metric_date, planned_visits, visits_synced
     FROM shop_paid_promotion_metrics
     WHERE promotion_id = $1
     ORDER BY metric_date ASC`, [promotion.id]);
    if (planRes.rows.length === 0)
        return 0;
    const planRows = planRes.rows.map((row) => ({
        date: toDateKey(row.metric_date),
        visits: Number(row.planned_visits ?? 0),
        metricId: Number(row.id),
        visitsSynced: Number(row.visits_synced ?? 0),
    }));
    let releasedSeries;
    if (promotion.status === 'completed') {
        releasedSeries = planRows.map((row) => ({ date: row.date, visits: row.visits }));
    }
    else {
        const released = getReleasedMetricsFromPlan(planRows, {
            campaignStartAt: promotion.campaignStartAt,
            campaignEndAt: promotion.campaignEndAt,
            scheduleSeed: promotion.scheduleSeed ?? promotion.id,
        });
        releasedSeries = released.series;
    }
    const syncedByDate = new Map(planRows.map((row) => [row.date, row]));
    const client = await pool.connect();
    let totalDelta = 0;
    try {
        await client.query('BEGIN');
        for (const row of releasedSeries) {
            const metric = syncedByDate.get(row.date);
            if (!metric)
                continue;
            const delta = Math.max(0, Math.round(row.visits) - metric.visitsSynced);
            if (delta <= 0)
                continue;
            await client.query(`INSERT INTO shop_daily_visits (shop_id, visit_date, organic_visits, promotion_visits)
         VALUES ($1, $2::date, 0, $3)
         ON CONFLICT (shop_id, visit_date)
         DO UPDATE SET promotion_visits = shop_daily_visits.promotion_visits + $3`, [promotion.shopId, row.date, delta]);
            await client.query(`UPDATE shop_paid_promotion_metrics
         SET visits_synced = visits_synced + $1
         WHERE id = $2`, [delta, metric.metricId]);
            totalDelta += delta;
        }
        if (totalDelta > 0) {
            await client.query('UPDATE shops SET visits = COALESCE(visits, 0) + $1 WHERE id = $2', [totalDelta, promotion.shopId]);
        }
        await client.query('COMMIT');
    }
    catch (e) {
        await client.query('ROLLBACK');
        throw e;
    }
    finally {
        client.release();
    }
    return totalDelta;
}

export async function syncShopPromotionVisits(shopId) {
    const pool = getPool();
    const res = await pool.query(`SELECT id FROM shop_paid_promotions
     WHERE shop_id = $1
       AND status IN ('active', 'completed')
       AND campaign_start_at IS NOT NULL`, [shopId]);
    for (const row of res.rows) {
        const promotion = await getPromotionById(row.id);
        if (promotion)
            await syncPromotionVisitsToShop(promotion);
    }
}

export async function syncAllActivePromotionVisits() {
    const pool = getPool();
    const res = await pool.query(`SELECT id FROM shop_paid_promotions
     WHERE status = 'active' AND campaign_start_at IS NOT NULL`);
    for (const row of res.rows) {
        const promotion = await getPromotionById(row.id);
        if (promotion)
            await syncPromotionVisitsToShop(promotion);
    }
}

export async function getShopVisitSummary(shopId) {
    const pool = getPool();
    const [totalRes, todayRes, weekRes, monthRes, trendRes] = await Promise.all([
        pool.query('SELECT COALESCE(visits, 0)::text AS visits FROM shops WHERE id = $1', [shopId]),
        pool.query(`SELECT COALESCE(SUM(organic_visits + promotion_visits), 0)::text AS visits
       FROM shop_daily_visits
       WHERE shop_id = $1 AND visit_date = CURRENT_DATE`, [shopId]),
        pool.query(`SELECT COALESCE(SUM(organic_visits + promotion_visits), 0)::text AS visits
       FROM shop_daily_visits
       WHERE shop_id = $1 AND visit_date >= CURRENT_DATE - INTERVAL '6 days'`, [shopId]),
        pool.query(`SELECT COALESCE(SUM(organic_visits + promotion_visits), 0)::text AS visits
       FROM shop_daily_visits
       WHERE shop_id = $1 AND visit_date >= CURRENT_DATE - INTERVAL '29 days'`, [shopId]),
        pool.query(`SELECT to_char(visit_date, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(organic_visits + promotion_visits), 0)::text AS visits
       FROM shop_daily_visits
       WHERE shop_id = $1
         AND visit_date >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY visit_date
       ORDER BY visit_date`, [shopId]),
    ]);
    const trendMap = new Map();
    for (const row of trendRes.rows) {
        trendMap.set(row.day, parseInt(row.visits ?? '0', 10) || 0);
    }
    const today = new Date();
    const dayLabels = [];
    const daily = [];
    const weekdayMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    for (let i = 6; i >= 0; i -= 1) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${day}`;
        dayLabels.push(weekdayMap[d.getDay()]);
        daily.push(trendMap.get(key) ?? 0);
    }
    return {
        visitsTotal: parseInt(totalRes.rows[0]?.visits ?? '0', 10) || 0,
        visitsToday: parseInt(todayRes.rows[0]?.visits ?? '0', 10) || 0,
        visits7d: parseInt(weekRes.rows[0]?.visits ?? '0', 10) || 0,
        visits30d: parseInt(monthRes.rows[0]?.visits ?? '0', 10) || 0,
        visitTrend: { labels: dayLabels, daily },
    };
}
