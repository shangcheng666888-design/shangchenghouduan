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

const DURATION_UNITS = new Set(['minute', 'hour', 'day']);

export function parseCampaignDuration({ durationValue, durationUnit, durationDays }) {
    let unit = typeof durationUnit === 'string' ? durationUnit.trim() : '';
    if (!DURATION_UNITS.has(unit))
        unit = 'day';
    let value = Math.round(Number(durationValue ?? durationDays ?? 0));
    if (unit === 'minute')
        value = Math.max(1, Math.min(1440, value));
    else if (unit === 'hour')
        value = Math.max(1, Math.min(2160, value));
    else
        value = Math.max(1, Math.min(90, value));
    return { value, unit };
}

export function addDurationToDate(startAt, value, unit) {
    const end = new Date(startAt instanceof Date ? startAt : new Date(startAt));
    if (unit === 'minute')
        end.setUTCMinutes(end.getUTCMinutes() + value);
    else if (unit === 'hour')
        end.setUTCHours(end.getUTCHours() + value);
    else
        end.setUTCDate(end.getUTCDate() + value);
    return end;
}

export function scheduleBucketCount(value, unit) {
    if (unit === 'day')
        return value;
    if (unit === 'hour')
        return Math.max(1, Math.min(90, Math.ceil(value / 24)));
    return 1;
}

function irregularProgressFactor(progress, seed, completed) {
    if (completed)
        return 1;
    if (progress <= 0)
        return 0;
    const rand = mulberry32(seed);
    const wave = Math.sin(progress * Math.PI * (1.1 + rand() * 0.4)) * 0.06;
    const jitter = (rand() - 0.5) * 0.04;
    return Math.min(1, Math.max(0, progress + wave + jitter));
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
    durationValue,
    durationUnit,
    startAt,
    presets,
}) {
    const parsed = parseCampaignDuration({ durationValue, durationUnit, durationDays });
    const buckets = scheduleBucketCount(parsed.value, parsed.unit);
    const seed = Number(promotionId) * 9973 + 17;
    const start = startAt instanceof Date ? startAt : new Date(startAt);
    const impressions = distributeIntegerTotal(presets.impressions, buckets, seed);
    const clicks = distributeIntegerTotal(presets.clicks, buckets, seed + 101);
    const visits = distributeIntegerTotal(presets.visits, buckets, seed + 203);
    const orders = distributeIntegerTotal(presets.orders ?? 0, buckets, seed + 307);
    const spend = distributeMoneyTotal(presets.spend, buckets, seed + 401);
    const revenue = distributeMoneyTotal(presets.revenue ?? 0, buckets, seed + 503);
    const rows = [];
    for (let i = 0; i < buckets; i += 1) {
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
    const durationMs = end.getTime() - start.getTime();
    const useCampaignWindow = durationMs < 86400000;
    const seed = Number(scheduleSeed || 0);
    const windowFactor = useCampaignWindow
        ? irregularProgressFactor(campaignProgress, seed, completed)
        : null;
    const series = planRows.map((row) => {
        const dayDate = new Date(`${row.date}T00:00:00Z`);
        let factor = 0;
        if (useCampaignWindow) {
            factor = windowFactor ?? 0;
        }
        else if (completed) {
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

const AUDIENCE_VALUE_SET = new Set(PROMOTION_AUDIENCES.map((item) => item.value));

/** Normalize merchant audience selection: multi-value comma string, or sole `all`. */
export function normalizeTargetAudience(input) {
    let values = [];
    if (Array.isArray(input)) {
        values = input.map((value) => String(value).trim()).filter(Boolean);
    }
    else if (typeof input === 'string') {
        values = input.split(',').map((value) => value.trim()).filter(Boolean);
    }
    else if (input != null && input !== '') {
        values = [String(input).trim()];
    }
    if (values.length === 0)
        return '';
    if (values.includes('all')) {
        if (!AUDIENCE_VALUE_SET.has('all'))
            throw new Error('audience_invalid');
        return 'all';
    }
    const unique = [...new Set(values)];
    for (const value of unique) {
        if (!AUDIENCE_VALUE_SET.has(value))
            throw new Error('audience_invalid');
    }
    return unique.join(',');
}
