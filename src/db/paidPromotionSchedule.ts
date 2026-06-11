// @ts-nocheck
function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state += 0x6d2b79f5;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function distributeIntegerTotal(total, parts, seedOffset) {
    const totalInt = Math.max(0, Math.round(Number(total) || 0));
    const count = Math.max(1, parts);
    if (totalInt === 0)
        return Array.from({ length: count }, () => 0);
    const rand = mulberry32(seedOffset);
    const weights = Array.from({ length: count }, () => 0.35 + rand() * 0.65);
    const weightSum = weights.reduce((sum, w) => sum + w, 0);
    const raw = weights.map((w) => (totalInt * w) / weightSum);
    const floors = raw.map((v) => Math.floor(v));
    let remainder = totalInt - floors.reduce((sum, v) => sum + v, 0);
    const ranked = raw
        .map((v, index) => ({ index, frac: v - Math.floor(v) }))
        .sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < remainder; i += 1) {
        floors[ranked[i % count].index] += 1;
    }
    return floors;
}

function distributeMoneyTotal(total, parts, seedOffset) {
    const cents = Math.max(0, Math.round(Number(total || 0) * 100));
    const chunks = distributeIntegerTotal(cents, parts, seedOffset);
    return chunks.map((value) => Math.round(value) / 100);
}

function toDateKey(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function startOfUtcDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function intradayReleaseFactor(dayDate, now, seed) {
    const dayStart = startOfUtcDay(dayDate).getTime();
    const dayEnd = dayStart + 86400000;
    const ts = now.getTime();
    if (ts <= dayStart)
        return 0;
    if (ts >= dayEnd)
        return 1;
    const linear = (ts - dayStart) / 86400000;
    const rand = mulberry32(seed + dayStart);
    const wave = Math.sin(linear * Math.PI * (1.2 + rand() * 0.8)) * 0.08;
    const jitter = (rand() - 0.5) * 0.06;
    return Math.min(1, Math.max(0, linear + wave + jitter));
}

export function buildCampaignScheduleRows({
    promotionId,
    durationDays,
    startAt,
    presets,
}) {
    const days = Math.max(1, Math.min(90, Math.round(Number(durationDays) || 1)));
    const seed = Number(promotionId) * 9973 + 17;
    const start = startAt instanceof Date ? startAt : new Date(startAt);
    const impressions = distributeIntegerTotal(presets.impressions, days, seed);
    const clicks = distributeIntegerTotal(presets.clicks, days, seed + 101);
    const visits = distributeIntegerTotal(presets.visits, days, seed + 203);
    const orders = distributeIntegerTotal(presets.orders, days, seed + 307);
    const spend = distributeMoneyTotal(presets.spend, days, seed + 401);
    const revenue = distributeMoneyTotal(presets.revenue, days, seed + 503);
    const rows = [];
    for (let i = 0; i < days; i += 1) {
        const day = new Date(start);
        day.setUTCDate(start.getUTCDate() + i);
        rows.push({
            date: toDateKey(day),
            impressions: impressions[i],
            clicks: clicks[i],
            visits: visits[i],
            orders: orders[i],
            spend: spend[i],
            revenue: revenue[i],
        });
    }
    return rows;
}

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

export function getReleasedMetricsFromPlan(planRows, {
    campaignStartAt,
    campaignEndAt,
    scheduleSeed,
    now = new Date(),
}) {
    if (!campaignStartAt || !campaignEndAt || !Array.isArray(planRows) || planRows.length === 0) {
        return {
            series: [],
            totals: {
                impressions: 0,
                clicks: 0,
                visits: 0,
                orders: 0,
                spend: 0,
                revenue: 0,
            },
            campaignProgress: 0,
            budgetProgress: 0,
            isCompleted: false,
        };
    }
    const start = new Date(campaignStartAt);
    const end = new Date(campaignEndAt);
    const ts = now.getTime();
    const completed = ts >= end.getTime();
    const campaignProgress = completed
        ? 1
        : ts <= start.getTime()
            ? 0
            : Math.min(1, (ts - start.getTime()) / Math.max(1, end.getTime() - start.getTime()));
    const seed = Number(scheduleSeed || 0);
    const series = planRows.map((row) => {
        const dayDate = new Date(`${row.date}T00:00:00Z`);
        let factor = 0;
        if (completed) {
            factor = 1;
        }
        else if (ts >= startOfUtcDay(dayDate).getTime() + 86400000) {
            factor = 1;
        }
        else if (ts >= startOfUtcDay(dayDate).getTime()) {
            factor = intradayReleaseFactor(dayDate, now, seed);
        }
        return {
            date: row.date,
            impressions: Math.round((row.impressions ?? 0) * factor),
            clicks: Math.round((row.clicks ?? 0) * factor),
            visits: Math.round((row.visits ?? 0) * factor),
            orders: Math.round((row.orders ?? 0) * factor),
            spend: roundMoney((row.spend ?? 0) * factor),
            revenue: roundMoney((row.revenue ?? 0) * factor),
        };
    });
    const totals = series.reduce((acc, row) => ({
        impressions: acc.impressions + row.impressions,
        clicks: acc.clicks + row.clicks,
        visits: acc.visits + row.visits,
        orders: acc.orders + row.orders,
        spend: roundMoney(acc.spend + row.spend),
        revenue: roundMoney(acc.revenue + row.revenue),
    }), {
        impressions: 0,
        clicks: 0,
        visits: 0,
        orders: 0,
        spend: 0,
        revenue: 0,
    });
    const plannedSpend = roundMoney(planRows.reduce((sum, row) => sum + Number(row.spend ?? 0), 0));
    const budgetProgress = plannedSpend > 0 ? Math.min(1, totals.spend / plannedSpend) : campaignProgress;
    return {
        series,
        totals,
        campaignProgress: roundMoney(campaignProgress * 100) / 100,
        budgetProgress: roundMoney(budgetProgress * 100) / 100,
        isCompleted: completed,
    };
}

export const PROMOTION_REGIONS = [
    { value: 'north_america', labelZh: '北美', labelEn: 'North America' },
    { value: 'europe', labelZh: '欧洲', labelEn: 'Europe' },
    { value: 'southeast_asia', labelZh: '东南亚', labelEn: 'Southeast Asia' },
    { value: 'middle_east', labelZh: '中东', labelEn: 'Middle East' },
    { value: 'latin_america', labelZh: '拉美', labelEn: 'Latin America' },
    { value: 'global', labelZh: '全球', labelEn: 'Global' },
];

export const PROMOTION_AUDIENCES = [
    { value: 'all', labelZh: '全部受众', labelEn: 'All audiences' },
    { value: 'young_adults', labelZh: '年轻群体 18-34', labelEn: 'Young adults 18-34' },
    { value: 'women', labelZh: '女性用户', labelEn: 'Women' },
    { value: 'men', labelZh: '男性用户', labelEn: 'Men' },
    { value: 'parents', labelZh: '家长群体', labelEn: 'Parents' },
    { value: 'high_intent', labelZh: '高购买意向', labelEn: 'High purchase intent' },
];
