// @ts-nocheck
import { getPool } from '../db.js';
import {
    addDurationToDate,
    buildCampaignScheduleRows,
    getReleasedMetricsFromPlan,
    normalizeTargetAudience,
    parseCampaignDuration,
    PROMOTION_AUDIENCES,
    PROMOTION_REGIONS,
} from './paidPromotionSchedule.js';
import { syncPromotionVisitsToShop } from './shopVisitSync.js';

const CHANNELS = new Set(['tiktok', 'meta', 'google', 'other']);
const STATUSES = new Set(['pending', 'awaiting_launch', 'active', 'paused', 'ended', 'completed']);
const TARGET_TYPES = new Set(['shop', 'product']);
const MERCHANT_VISIBLE_STATUSES = ['pending', 'awaiting_launch', 'active'];
const REGION_VALUES = new Set(PROMOTION_REGIONS.map((item) => item.value));

function canConfigureOrLaunchCampaign(promotion) {
    if (!promotion)
        return false;
    if (promotion.status === 'awaiting_launch')
        return true;
    if (promotion.status === 'active' && promotion.merchantConfirmedAt && !promotion.campaignStartAt)
        return true;
    return false;
}

function rowToPromotion(row) {
    if (!row)
        return null;
    return {
        id: Number(row.id),
        shopId: row.shop_id,
        shopName: row.shop_name ?? null,
        shopLogo: row.shop_logo ?? null,
        ownerAccount: row.owner_account ?? null,
        channel: row.channel,
        status: row.status,
        targetType: row.target_type ?? null,
        targetListingId: row.target_listing_id ?? null,
        targetProductId: row.target_product_id ?? null,
        targetProductTitle: row.target_product_title ?? null,
        targetProductImage: row.target_product_image ?? null,
        targetRegion: row.target_region ?? null,
        targetAudience: row.target_audience ?? null,
        adminNote: row.admin_note ?? null,
        merchantConfirmedAt: row.merchant_confirmed_at ?? null,
        campaignDurationDays: row.campaign_duration_days != null ? Number(row.campaign_duration_days) : null,
        campaignDurationValue: row.campaign_duration_value != null
            ? Number(row.campaign_duration_value)
            : (row.campaign_duration_days != null ? Number(row.campaign_duration_days) : null),
        campaignDurationUnit: row.campaign_duration_unit ?? (row.campaign_duration_days != null ? 'day' : null),
        budgetTotal: row.budget_total != null ? Math.round(Number(row.budget_total) * 100) / 100 : null,
        presetImpressions: row.preset_impressions != null ? Number(row.preset_impressions) : null,
        presetClicks: row.preset_clicks != null ? Number(row.preset_clicks) : null,
        presetVisits: row.preset_visits != null ? Number(row.preset_visits) : null,
        presetOrders: row.preset_orders != null ? Number(row.preset_orders) : null,
        presetRevenue: row.preset_revenue != null ? Math.round(Number(row.preset_revenue) * 100) / 100 : null,
        campaignStartAt: row.campaign_start_at ?? null,
        campaignEndAt: row.campaign_end_at ?? null,
        pausedAt: row.paused_at ?? null,
        pausedAccumulatedMs: row.paused_accumulated_ms != null ? Number(row.paused_accumulated_ms) : 0,
        scheduleSeed: row.schedule_seed != null ? Number(row.schedule_seed) : null,
        activatedAt: row.activated_at ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToPlanMetric(row) {
    return {
        date: row.metric_date instanceof Date
            ? row.metric_date.toISOString().slice(0, 10)
            : String(row.metric_date).slice(0, 10),
        impressions: Number(row.planned_impressions ?? row.impressions ?? 0),
        clicks: Number(row.planned_clicks ?? row.clicks ?? 0),
        visits: Number(row.planned_visits ?? row.visits ?? 0),
        orders: Number(row.planned_orders ?? row.orders ?? 0),
        spend: Math.round(Number(row.planned_spend ?? row.spend ?? 0) * 100) / 100,
        revenue: Math.round(Number(row.planned_revenue ?? row.revenue ?? 0) * 100) / 100,
    };
}

const PROMOTION_SELECT = `
  SELECT
    p.*,
    s.name AS shop_name,
    s.logo AS shop_logo,
    u.account AS owner_account,
    prod.product_name AS target_product_title,
    sp.product_id AS target_product_id,
    CASE
      WHEN jsonb_typeof(prod.main_images) = 'array' AND jsonb_array_length(prod.main_images) > 0
      THEN prod.main_images->>0
      ELSE NULL
    END AS target_product_image
  FROM shop_paid_promotions p
  LEFT JOIN shops s ON s.id = p.shop_id
  LEFT JOIN users u ON u.id = s.owner_id
  LEFT JOIN shop_products sp ON sp.id::text = p.target_listing_id AND sp.shop_id = p.shop_id
  LEFT JOIN products prod ON prod.product_id = sp.product_id
`;

async function getPlanRows(promotionId) {
    const pool = getPool();
    const res = await pool.query(`SELECT metric_date, planned_impressions, planned_clicks, planned_visits, planned_orders, planned_spend, planned_revenue,
            impressions, clicks, visits, orders, spend, revenue
     FROM shop_paid_promotion_metrics
     WHERE promotion_id = $1
     ORDER BY metric_date ASC`, [promotionId]);
    return res.rows.map(rowToPlanMetric);
}

function isCampaignEffectivelyComplete(promotion, nowMs = Date.now()) {
    if (!promotion?.campaignStartAt || !promotion?.campaignEndAt)
        return false;
    const start = new Date(promotion.campaignStartAt).getTime();
    const durationMs = new Date(promotion.campaignEndAt).getTime() - start;
    const pausedMs = Math.max(0, Number(promotion.pausedAccumulatedMs) || 0);
    const elapsedMs = Math.max(0, nowMs - start - pausedMs);
    return elapsedMs >= durationMs;
}

async function maybeCompletePromotion(promotion) {
    if (!promotion || promotion.status !== 'active' || !promotion.campaignEndAt)
        return promotion;
    if (!isCampaignEffectivelyComplete(promotion))
        return promotion;
    await syncPromotionVisitsToShop(promotion);
    const pool = getPool();
    await pool.query(`UPDATE shop_paid_promotions
     SET status = 'completed', updated_at = now()
     WHERE id = $1 AND status = 'active'`, [promotion.id]);
    return getPromotionById(promotion.id);
}

async function finalizeDueCampaignsForShop(shopId) {
    const pool = getPool();
    const dueRes = await pool.query(`SELECT id FROM shop_paid_promotions
     WHERE shop_id = $1
       AND status = 'active'
       AND campaign_start_at IS NOT NULL
       AND campaign_end_at IS NOT NULL`, [shopId]);
    for (const row of dueRes.rows) {
        const promotion = await getPromotionById(row.id);
        if (promotion && isCampaignEffectivelyComplete(promotion))
            await maybeCompletePromotion(promotion);
    }
}

function isMerchantVisiblePromotion(promotion) {
    return Boolean(promotion && MERCHANT_VISIBLE_STATUSES.includes(promotion.status));
}

export async function getMerchantPromotionByShopId(shopId) {
    await finalizeDueCampaignsForShop(shopId);
    const pool = getPool();
    const res = await pool.query(`${PROMOTION_SELECT}
     WHERE p.shop_id = $1 AND p.status = ANY($2::text[])
     ORDER BY
       CASE p.status
         WHEN 'active' THEN 0
         WHEN 'awaiting_launch' THEN 1
         ELSE 2
       END,
       p.updated_at DESC
     LIMIT 1`, [shopId, MERCHANT_VISIBLE_STATUSES]);
    let promotion = rowToPromotion(res.rows[0]);
    if (!promotion)
        return null;
    promotion = await maybeCompletePromotion(promotion);
    if (!isMerchantVisiblePromotion(promotion))
        return null;
    return promotion;
}

export async function getPromotionById(id) {
    const pool = getPool();
    const res = await pool.query(`${PROMOTION_SELECT} WHERE p.id = $1`, [id]);
    return rowToPromotion(res.rows[0]);
}

export async function listPromotions({ status, shopId, search, limit, offset } = {}) {
    const pool = getPool();
    const params = [];
    let where = 'WHERE 1=1';
    if (status && STATUSES.has(status)) {
        params.push(status);
        where += ` AND p.status = $${params.length}`;
    }
    if (shopId) {
        params.push(shopId);
        where += ` AND p.shop_id = $${params.length}`;
    }
    if (search) {
        params.push(`%${search}%`);
        where += ` AND (p.shop_id ILIKE $${params.length} OR s.name ILIKE $${params.length} OR u.account ILIKE $${params.length})`;
    }
    let limitSql = '';
    if (Number.isFinite(limit) && limit > 0) {
        params.push(Math.min(limit, 200));
        limitSql += ` LIMIT $${params.length}`;
    }
    if (Number.isFinite(offset) && offset > 0) {
        params.push(offset);
        limitSql += ` OFFSET $${params.length}`;
    }
    const res = await pool.query(`${PROMOTION_SELECT}
     ${where}
     ORDER BY
       CASE p.status
         WHEN 'awaiting_launch' THEN 0
         WHEN 'active' THEN 1
         WHEN 'pending' THEN 2
         WHEN 'paused' THEN 3
         ELSE 4
       END,
       p.updated_at DESC${limitSql}`, params);
    return res.rows.map(rowToPromotion);
}

export async function listPromotionRecordsAdmin({ shopId, search, status, limit = 100, offset = 0 } = {}) {
    const pool = getPool();
    const params = [];
    let where = 'WHERE 1=1';
    if (shopId) {
        params.push(shopId);
        where += ` AND p.shop_id = $${params.length}`;
    }
    if (search) {
        params.push(`%${search}%`);
        where += ` AND (p.shop_id ILIKE $${params.length} OR s.name ILIKE $${params.length} OR u.account ILIKE $${params.length})`;
    }
    if (status && status !== 'all' && STATUSES.has(status)) {
        params.push(status);
        where += ` AND p.status = $${params.length}`;
    }
    params.push(Math.min(Math.max(limit, 1), 200));
    params.push(Math.max(offset, 0));
    const res = await pool.query(`${PROMOTION_SELECT}
     ${where}
     ORDER BY p.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    const promotions = res.rows.map(rowToPromotion);
    const items = [];
    for (const promotion of promotions) {
        let metricsSummary = null;
        if (promotion.campaignStartAt) {
            const metrics = await getPromotionMetrics(promotion.id);
            metricsSummary = {
                totals: metrics.totals,
                presets: metrics.presets,
                campaignProgress: metrics.campaignProgress,
                budgetProgress: metrics.budgetProgress,
                isCompleted: metrics.isCompleted,
            };
        }
        items.push({ promotion, metricsSummary });
    }
    return items;
}

export async function createPromotion({ shopId, channel, status = 'pending', adminNote }) {
    if (!CHANNELS.has(channel))
        throw new Error('invalid_channel');
    const nextStatus = STATUSES.has(status) ? status : 'pending';
    const pool = getPool();
    const res = await pool.query(`INSERT INTO shop_paid_promotions (shop_id, channel, status, admin_note, schedule_seed)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`, [shopId, channel, nextStatus, adminNote ?? null, Math.floor(Math.random() * 1000000)]);
    return getPromotionById(res.rows[0].id);
}

export async function updatePromotion(id, patch) {
    const existing = await getPromotionById(id);
    if (!existing)
        return null;
    const fields = [];
    const params = [];
    if (patch.channel !== undefined) {
        if (!CHANNELS.has(patch.channel))
            throw new Error('invalid_channel');
        params.push(patch.channel);
        fields.push(`channel = $${params.length}`);
    }
    if (patch.status !== undefined) {
        if (!STATUSES.has(patch.status))
            throw new Error('invalid_status');
        const nextStatus = patch.status;
        const prevStatus = existing.status;
        params.push(nextStatus);
        fields.push(`status = $${params.length}`);
        if (nextStatus === 'active' && !existing.activatedAt) {
            fields.push('activated_at = now()');
        }
        if (nextStatus === 'paused' && prevStatus === 'active') {
            fields.push('paused_at = now()');
        }
        if (nextStatus === 'active' && prevStatus === 'paused') {
            fields.push(`paused_accumulated_ms = COALESCE(paused_accumulated_ms, 0) + GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(paused_at, now()))) * 1000))`);
            fields.push('paused_at = NULL');
        }
        if (nextStatus === 'ended' || nextStatus === 'completed') {
            fields.push('paused_at = NULL');
        }
    }
    if (patch.adminNote !== undefined) {
        params.push(patch.adminNote);
        fields.push(`admin_note = $${params.length}`);
    }
    if (fields.length === 0)
        return existing;
    params.push(id);
    const pool = getPool();
    await pool.query(`UPDATE shop_paid_promotions
     SET ${fields.join(', ')}, updated_at = now()
     WHERE id = $${params.length}`, params);
    return getPromotionById(id);
}

export async function setPromotionTarget(id, {
    targetType,
    targetListingId,
    targetRegion,
    targetAudience,
}) {
    if (!TARGET_TYPES.has(targetType))
        throw new Error('invalid_target_type');
    const existing = await getPromotionById(id);
    if (!existing)
        return null;
    const canEditTarget = ['pending', 'awaiting_launch'].includes(existing.status)
        || (existing.status === 'active' && !existing.merchantConfirmedAt);
    if (!canEditTarget)
        throw new Error('promotion_not_editable');
    const pool = getPool();
    const region = typeof targetRegion === 'string' ? targetRegion.trim() : '';
    let audience = '';
    try {
        audience = normalizeTargetAudience(targetAudience);
    }
    catch {
        throw new Error('audience_invalid');
    }
    if (!audience)
        throw new Error('audience_required');
    if (targetType === 'product') {
        const listingId = typeof targetListingId === 'string' ? targetListingId.trim() : '';
        if (!listingId)
            throw new Error('listing_required');
        if (!REGION_VALUES.has(region))
            throw new Error('region_required');
        const check = await pool.query(`SELECT id FROM shop_products
       WHERE shop_id = $1 AND id::text = $2 AND status = 'on'`, [existing.shopId, listingId]);
        if (check.rows.length === 0)
            throw new Error('listing_not_found');
        await pool.query(`UPDATE shop_paid_promotions
       SET target_type = 'product',
           target_listing_id = $1,
           target_region = $2,
           target_audience = $3,
           merchant_confirmed_at = now(),
           status = 'awaiting_launch',
           updated_at = now()
       WHERE id = $4`, [listingId, region, audience, id]);
    }
    else {
        if (!REGION_VALUES.has(region))
            throw new Error('region_required');
        await pool.query(`UPDATE shop_paid_promotions
       SET target_type = 'shop',
           target_listing_id = NULL,
           target_region = $1,
           target_audience = $2,
           merchant_confirmed_at = now(),
           status = 'awaiting_launch',
           updated_at = now()
       WHERE id = $3`, [region, audience, id]);
    }
    return getPromotionById(id);
}

export async function saveCampaignDraft(id, config) {
    const existing = await getPromotionById(id);
    if (!existing)
        return null;
    if (!canConfigureOrLaunchCampaign(existing))
        throw new Error('promotion_not_awaiting_launch');
    const { value: durationValue, unit: durationUnit } = parseCampaignDuration({
        durationValue: config.durationValue ?? config.durationDays,
        durationUnit: config.durationUnit,
        durationDays: config.durationDays,
    });
    const durationDays = durationUnit === 'day' ? durationValue : 1;
    const budgetTotal = Math.max(0, Number(config.budgetTotal ?? 0));
    const impressions = Math.max(0, Math.round(Number(config.impressions ?? 0)));
    const clicks = Math.max(0, Math.round(Number(config.clicks ?? 0)));
    if (impressions > 0 && clicks > impressions)
        throw new Error('clicks_exceed_impressions');
    const visits = Math.max(0, Math.round(Number(config.visits ?? 0)));
    const pool = getPool();
    await pool.query(`UPDATE shop_paid_promotions
     SET campaign_duration_days = $1,
         campaign_duration_value = $2,
         campaign_duration_unit = $3,
         budget_total = $4,
         preset_impressions = $5,
         preset_clicks = $6,
         preset_visits = $7,
         preset_orders = 0,
         preset_revenue = 0,
         updated_at = now()
     WHERE id = $8`, [
        durationDays,
        durationValue,
        durationUnit,
        budgetTotal,
        impressions,
        clicks,
        visits,
        id,
    ]);
    return getPromotionById(id);
}

export async function launchCampaign(id) {
    const existing = await getPromotionById(id);
    if (!existing)
        return null;
    if (!canConfigureOrLaunchCampaign(existing))
        throw new Error('promotion_not_awaiting_launch');
    const duration = parseCampaignDuration({
        durationValue: existing.campaignDurationValue ?? existing.campaignDurationDays,
        durationUnit: existing.campaignDurationUnit,
        durationDays: existing.campaignDurationDays,
    });
    if (!duration.value || existing.budgetTotal == null || existing.presetImpressions == null)
        throw new Error('campaign_config_incomplete');
    const startAt = new Date();
    const endAt = addDurationToDate(startAt, duration.value, duration.unit);
    const scheduleRows = buildCampaignScheduleRows({
        promotionId: existing.id,
        durationValue: duration.value,
        durationUnit: duration.unit,
        durationDays: existing.campaignDurationDays,
        startAt,
        presets: {
            impressions: existing.presetImpressions,
            clicks: existing.presetClicks ?? 0,
            visits: existing.presetVisits ?? 0,
            orders: 0,
            spend: existing.budgetTotal,
            revenue: 0,
        },
    });
    const pool = getPool();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM shop_paid_promotion_metrics WHERE promotion_id = $1', [id]);
        for (const row of scheduleRows) {
            await client.query(`INSERT INTO shop_paid_promotion_metrics
         (promotion_id, metric_date, impressions, clicks, visits, orders, spend, revenue,
          planned_impressions, planned_clicks, planned_visits, planned_orders, planned_spend, planned_revenue)
         VALUES ($1, $2::date, 0, 0, 0, 0, 0, 0, $3, $4, $5, $6, $7, $8)`, [
                id,
                row.date,
                row.impressions,
                row.clicks,
                row.visits,
                row.orders,
                row.spend,
                row.revenue,
            ]);
        }
        await client.query(`UPDATE shop_paid_promotions
       SET status = 'active',
           campaign_start_at = $1,
           campaign_end_at = $2,
           activated_at = COALESCE(activated_at, $1),
           schedule_seed = COALESCE(schedule_seed, $3),
           updated_at = now()
       WHERE id = $4`, [startAt, endAt, existing.scheduleSeed ?? existing.id, id]);
        await client.query('COMMIT');
    }
    catch (e) {
        await client.query('ROLLBACK');
        throw e;
    }
    finally {
        client.release();
    }
    return getPromotionById(id);
}

export async function getPromotionMetrics(promotionId) {
    const promotion = await getPromotionById(promotionId);
    if (!promotion)
        return { series: [], totals: { impressions: 0, clicks: 0, visits: 0, orders: 0, spend: 0, revenue: 0 } };
    if (promotion.status === 'active')
        await syncPromotionVisitsToShop(promotion);
    const planRows = await getPlanRows(promotionId);
    const presets = {
        impressions: promotion.presetImpressions ?? 0,
        clicks: promotion.presetClicks ?? 0,
        visits: promotion.presetVisits ?? 0,
        orders: promotion.presetOrders ?? 0,
        spend: promotion.budgetTotal ?? 0,
        revenue: promotion.presetRevenue ?? 0,
    };
    if (planRows.length === 0) {
        return {
            series: [],
            totals: { impressions: 0, clicks: 0, visits: 0, orders: 0, spend: 0, revenue: 0 },
            presets,
            campaignProgress: 0,
            budgetProgress: 0,
            isCompleted: promotion.status === 'completed',
        };
    }
    if (promotion.status === 'completed' || promotion.status === 'ended') {
        const totals = planRows.reduce((acc, row) => ({
            impressions: acc.impressions + row.impressions,
            clicks: acc.clicks + row.clicks,
            visits: acc.visits + row.visits,
            orders: acc.orders + row.orders,
            spend: Math.round((acc.spend + row.spend) * 100) / 100,
            revenue: Math.round((acc.revenue + row.revenue) * 100) / 100,
        }), { impressions: 0, clicks: 0, visits: 0, orders: 0, spend: 0, revenue: 0 });
        return {
            series: planRows,
            totals,
            presets: {
                impressions: promotion.presetImpressions ?? totals.impressions,
                clicks: promotion.presetClicks ?? totals.clicks,
                visits: promotion.presetVisits ?? totals.visits,
                orders: promotion.presetOrders ?? totals.orders,
                spend: promotion.budgetTotal ?? totals.spend,
                revenue: promotion.presetRevenue ?? totals.revenue,
            },
            campaignProgress: 1,
            budgetProgress: 1,
            isCompleted: true,
        };
    }
    if (promotion.status === 'paused') {
        const freezeAt = promotion.pausedAt
            ? new Date(promotion.pausedAt)
            : (promotion.updatedAt ? new Date(promotion.updatedAt) : new Date());
        const released = getReleasedMetricsFromPlan(planRows, {
            campaignStartAt: promotion.campaignStartAt,
            campaignEndAt: promotion.campaignEndAt,
            scheduleSeed: promotion.scheduleSeed ?? promotion.id,
            now: freezeAt,
            pausedAccumulatedMs: promotion.pausedAccumulatedMs ?? 0,
        });
        return {
            ...released,
            presets,
            isCompleted: false,
        };
    }
    const released = getReleasedMetricsFromPlan(planRows, {
        campaignStartAt: promotion.campaignStartAt,
        campaignEndAt: promotion.campaignEndAt,
        scheduleSeed: promotion.scheduleSeed ?? promotion.id,
        pausedAccumulatedMs: promotion.pausedAccumulatedMs ?? 0,
    });
    return {
        ...released,
        presets,
    };
}

export async function listActiveCampaignsWithProgress() {
    const list = await listPromotions({ status: 'active' });
    const running = [];
    for (const promotion of list) {
        if (!promotion?.campaignStartAt || !promotion?.campaignEndAt)
            continue;
        const refreshed = await maybeCompletePromotion(promotion);
        if (!refreshed || refreshed.status !== 'active')
            continue;
        const metrics = await getPromotionMetrics(refreshed.id);
        const now = Date.now();
        const start = new Date(refreshed.campaignStartAt).getTime();
        const durationMs = new Date(refreshed.campaignEndAt).getTime() - start;
        const pausedMs = Math.max(0, Number(refreshed.pausedAccumulatedMs) || 0);
        const elapsedMs = Math.max(0, now - start - pausedMs);
        const remainingMs = Math.max(0, durationMs - elapsedMs);
        running.push({
            promotion: refreshed,
            metrics,
            remainingMs,
            remainingSeconds: Math.ceil(remainingMs / 1000),
            isSettling: remainingMs <= 0,
        });
    }
    running.sort((a, b) => a.remainingMs - b.remainingMs);
    return running;
}

export async function listPromotionHistoryByShopId(shopId) {
    await finalizeDueCampaignsForShop(shopId);
    const pool = getPool();
    const res = await pool.query(`${PROMOTION_SELECT}
     WHERE p.shop_id = $1
       AND p.status IN ('completed', 'ended')
     ORDER BY COALESCE(p.campaign_end_at, p.updated_at) DESC
     LIMIT 50`, [shopId]);
    const items = [];
    for (const row of res.rows) {
        const promotion = rowToPromotion(row);
        const metrics = await getPromotionMetrics(promotion.id);
        items.push({ promotion, metrics });
    }
    return items;
}

export { PROMOTION_REGIONS, PROMOTION_AUDIENCES };
