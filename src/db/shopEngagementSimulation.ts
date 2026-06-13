import { getPool } from '../db.js'
import { bumpShopDataVersion } from './shopSync.js'

const VISIT_MIN = 20
const VISIT_MAX = 100
const FOLLOWER_MIN = 3
const FOLLOWER_MAX = 20

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomInt(min: number, max: number): number {
  const lo = Math.ceil(min)
  const hi = Math.floor(max)
  if (hi <= lo) return lo
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

function randomFloat(): number {
  return Math.random()
}

/** 北京时间小时（0-23），模拟本地用户活跃时段 */
function beijingHour(): number {
  return (new Date().getUTCHours() + 8) % 24
}

function beijingMinute(): number {
  return new Date().getUTCMinutes()
}

/** 按北京时间划分的自然日（YYYY-MM-DD），保证「每天」独立计划 */
function todayDateKey(): string {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

/** 当天已过去比例（0~1，北京时间） */
function dayProgressBeijing(): number {
  return (beijingHour() * 60 + beijingMinute()) / (24 * 60)
}

/** 当天剩余时间比例；下午新上架的店铺按剩余时段折减当日目标 */
function prorateDailyTarget(fullTarget: number): number {
  const remain = Math.max(0.28, 1 - dayProgressBeijing())
  return Math.max(VISIT_MIN, Math.min(VISIT_MAX, Math.round(fullTarget * remain)))
}

/** 进程内跟踪自然日切换，跨天时立即生成新一天计划（非一次性） */
let activePlanDate = todayDateKey()

async function onBeijingDayRollover(): Promise<void> {
  const today = todayDateKey()
  if (today === activePlanDate) return
  activePlanDate = today
  await ensureDailyEngagementPlans(today)
  console.log(`[engagement simulation] beijing day rollover → ${today}, fresh daily plans created`)
}

function scheduleBeijingMidnightRefresh(): void {
  const run = () => {
    const hour = beijingHour()
    const minute = beijingMinute()
    const second = new Date().getUTCSeconds()
    const msUntilMidnight =
      ((23 - hour) * 3600 + (59 - minute) * 60 + (59 - second)) * 1000 +
      randomInt(20_000, 120_000)

    setTimeout(async () => {
      try {
        activePlanDate = todayDateKey()
        await ensureDailyEngagementPlans(activePlanDate)
        console.log(`[engagement simulation] midnight refresh for ${activePlanDate}`)
      } catch (e) {
        console.error('[engagement simulation] midnight refresh failed', e)
      }
      run()
    }, Math.max(60_000, msUntilMidnight))
  }
  run()
}

function hashShopSeed(shopId: string): number {
  let hash = 0
  for (let i = 0; i < shopId.length; i += 1) {
    hash = (hash * 31 + shopId.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/** 全局时段活跃度：深夜极低，白天/晚间有峰谷 */
function globalHourWeight(hour: number): number {
  const curve = [
    0.04, 0.03, 0.02, 0.02, 0.03, 0.05,
    0.14, 0.38, 0.58, 0.76, 0.86, 0.82,
    0.68, 0.62, 0.74, 0.86, 0.92, 0.96,
    0.90, 0.82, 0.64, 0.42, 0.22, 0.10,
  ]
  return curve[hour] ?? 0.5
}

/** 每店有偏好的「高峰小时」，叠加全局曲线 */
function shopActivityWeight(shopId: string, hour: number): number {
  const peakHour = hashShopSeed(shopId) % 24
  const dist = Math.min(Math.abs(hour - peakHour), 24 - Math.abs(hour - peakHour))
  const shopBias = 0.55 + 0.45 * Math.exp(-dist / 3.5)
  return globalHourWeight(hour) * shopBias
}

/** 访客越少，当日关注上限越低：20 访客约 ≤5 关注，100 访客可达 20 */
export function maxFollowersForVisits(visits: number): number {
  const v = Math.max(VISIT_MIN, Math.min(VISIT_MAX, visits))
  return Math.min(FOLLOWER_MAX, Math.max(FOLLOWER_MIN, Math.round(5 + ((v - VISIT_MIN) / (VISIT_MAX - VISIT_MIN)) * 15)))
}

export function pickDailyFollowers(visits: number): number {
  const cap = maxFollowersForVisits(visits)
  return randomInt(FOLLOWER_MIN, cap)
}

/** 非均匀随机：多数店铺落在中间区间，极端值较少 */
export function pickDailyVisits(): number {
  const roll = randomFloat()
  if (roll < 0.12) return randomInt(20, 34)
  if (roll < 0.72) return randomInt(35, 72)
  if (roll < 0.92) return randomInt(73, 88)
  return randomInt(89, 100)
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

async function listEligibleShopIds(): Promise<string[]> {
  const pool = getPool()
  const res = await pool.query<{ shop_id: string }>(
    `SELECT DISTINCT s.id AS shop_id
     FROM shops s
     INNER JOIN shop_products sp ON sp.shop_id = s.id AND sp.status = 'on'
     WHERE s.status = 'normal'`,
  )
  return res.rows.map((row) => row.shop_id)
}

/** 封禁店铺不参与；须 status=normal 且至少 1 个上架商品 */
export async function isShopEligibleForEngagementSimulation(shopId: string): Promise<boolean> {
  const pool = getPool()
  const res = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM shops s
     WHERE s.id = $1
       AND s.status = 'normal'
       AND EXISTS (
         SELECT 1 FROM shop_products sp
         WHERE sp.shop_id = s.id AND sp.status = 'on'
       )`,
    [shopId],
  )
  return res.rows.length > 0
}

async function insertEngagementPlanForShop(shopId: string, planDate: string): Promise<void> {
  const pool = getPool()
  const fullVisits = pickDailyVisits()
  const targetVisits = prorateDailyTarget(fullVisits)
  const targetFollowers = pickDailyFollowers(targetVisits)
  await pool.query(
    `INSERT INTO shop_daily_engagement_plan (shop_id, plan_date, target_visits, target_followers)
     VALUES ($1, $2::date, $3, $4)
     ON CONFLICT (shop_id, plan_date) DO NOTHING`,
    [shopId, planDate, targetVisits, targetFollowers],
  )
}

/** 解封后立即恢复：若今日尚无计划则按剩余时段生成（有上架商品才生效） */
export async function ensureEngagementPlanForShopAfterUnban(shopId: string): Promise<void> {
  if (!(await isShopEligibleForEngagementSimulation(shopId))) return
  await insertEngagementPlanForShop(shopId, todayDateKey())
}

export async function ensureDailyEngagementPlans(planDate = todayDateKey()): Promise<void> {
  const pool = getPool()
  const shopIds = await listEligibleShopIds()
  for (const shopId of shopIds) {
    await insertEngagementPlanForShop(shopId, planDate)
  }
}

function isPlanBehindToday(plan: PlanRow): boolean {
  const dayProgress = dayProgressBeijing()
  if (dayProgress < 0.35) return false
  const visitRatio = plan.target_visits > 0 ? plan.delivered_visits / plan.target_visits : 1
  const followRatio = plan.target_followers > 0 ? plan.delivered_followers / plan.target_followers : 1
  return visitRatio < dayProgress - 0.12 || followRatio < dayProgress - 0.18
}

interface PlanRow {
  shop_id: string
  target_visits: number
  target_followers: number
  delivered_visits: number
  delivered_followers: number
}

async function deliverSimulatedEngagement(
  shopId: string,
  planDate: string,
  visitDelta: number,
  followDelta: number,
): Promise<void> {
  if (visitDelta <= 0 && followDelta <= 0) return
  if (!(await isShopEligibleForEngagementSimulation(shopId))) return

  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (visitDelta > 0) {
      await client.query('UPDATE shops SET visits = COALESCE(visits, 0) + $1 WHERE id = $2', [visitDelta, shopId])
      await client.query(
        `INSERT INTO shop_daily_visits (shop_id, visit_date, organic_visits, promotion_visits, simulated_visits)
         VALUES ($1, $2::date, 0, 0, $3)
         ON CONFLICT (shop_id, visit_date)
         DO UPDATE SET simulated_visits = shop_daily_visits.simulated_visits + EXCLUDED.simulated_visits`,
        [shopId, planDate, visitDelta],
      )
      await client.query(
        `UPDATE shop_daily_engagement_plan
         SET delivered_visits = delivered_visits + $1
         WHERE shop_id = $2 AND plan_date = $3::date`,
        [visitDelta, shopId, planDate],
      )
    }

    if (followDelta > 0) {
      await client.query('UPDATE shops SET followers = COALESCE(followers, 0) + $1 WHERE id = $2', [followDelta, shopId])
      await client.query(
        `INSERT INTO shop_daily_simulated_followers (shop_id, follow_date, follower_count)
         VALUES ($1, $2::date, $3)
         ON CONFLICT (shop_id, follow_date)
         DO UPDATE SET follower_count = shop_daily_simulated_followers.follower_count + EXCLUDED.follower_count`,
        [shopId, planDate, followDelta],
      )
      await client.query(
        `UPDATE shop_daily_engagement_plan
         SET delivered_followers = delivered_followers + $1
         WHERE shop_id = $2 AND plan_date = $3::date`,
        [followDelta, shopId, planDate],
      )
    }

    await client.query('COMMIT')
    await bumpShopDataVersion(shopId, ['dashboard', 'shop', 'all'])
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/** 模拟单次「访问」：多数 1 人，偶尔小高峰 */
function pickVisitBurst(remain: number): number {
  if (remain <= 0) return 0
  const roll = randomFloat()
  let burst: number
  if (roll < 0.58) burst = 1
  else if (roll < 0.84) burst = randomInt(2, 3)
  else if (roll < 0.96) burst = randomInt(4, 5)
  else burst = randomInt(6, Math.min(9, remain))
  return Math.min(burst, remain)
}

/** 关注滞后于浏览：有访客积累后才偶发关注，且不超过与访客匹配的上限 */
function pickFollowBurst(plan: PlanRow, visitsJustAdded: number): number {
  const followRemain = plan.target_followers - plan.delivered_followers
  if (followRemain <= 0) return 0

  const projectedVisits = plan.delivered_visits + visitsJustAdded
  if (projectedVisits <= 0) return 0

  const visitProgress = plan.target_visits > 0 ? projectedVisits / plan.target_visits : 0
  const allowedCap = maxFollowersForVisits(
    Math.max(VISIT_MIN, Math.round(visitProgress * plan.target_visits)),
  )
  const headroom = Math.max(0, allowedCap - plan.delivered_followers)
  if (headroom <= 0) return 0

  let chance = 0.06 + visitProgress * 0.18
  if (visitsJustAdded >= 3) chance += 0.1
  if (visitsJustAdded === 0) chance *= 0.45

  if (randomFloat() >= chance) return 0
  if (randomFloat() < 0.9 || headroom === 1) return 1
  return Math.min(2, followRemain, headroom)
}

/** 将一次访问拆成多次 +1，中间随机停顿，更像真实用户陆续进店 */
async function deliverVisitsWithNaturalRhythm(
  shopId: string,
  planDate: string,
  totalVisits: number,
): Promise<number> {
  if (totalVisits <= 0) return 0

  const shouldStagger = totalVisits > 1 && randomFloat() < 0.62
  if (!shouldStagger) {
    await deliverSimulatedEngagement(shopId, planDate, totalVisits, 0)
    return totalVisits
  }

  let delivered = 0
  let remaining = totalVisits
  while (remaining > 0) {
    const step = remaining === 1 ? 1 : randomInt(1, Math.min(2, remaining))
    await deliverSimulatedEngagement(shopId, planDate, step, 0)
    delivered += step
    remaining -= step
    if (remaining > 0) {
      await sleep(randomInt(400, 2_800))
    }
  }
  return delivered
}

function shouldShopReceiveTrafficThisTick(shopId: string, plan?: PlanRow): boolean {
  const hour = beijingHour()
  let weight = shopActivityWeight(shopId, hour)
  if (plan && isPlanBehindToday(plan)) {
    weight = Math.min(1, weight * 1.35)
  }
  return randomFloat() < 0.12 + weight * 0.88
}

function pickChunkForPlan(plan: PlanRow): { visitDelta: number; followDelta: number } {
  const visitRemain = plan.target_visits - plan.delivered_visits
  const followRemain = plan.target_followers - plan.delivered_followers
  if (visitRemain <= 0 && followRemain <= 0) {
    return { visitDelta: 0, followDelta: 0 }
  }

  let visitDelta = 0
  if (visitRemain > 0 && randomFloat() < 0.82) {
    visitDelta = pickVisitBurst(visitRemain)
  }

  const followDelta = pickFollowBurst(plan, visitDelta)
  return { visitDelta, followDelta }
}

function shouldRunTickNow(): boolean {
  const hour = beijingHour()
  const weight = globalHourWeight(hour)
  return randomFloat() < 0.1 + weight * 0.9
}

function nextTickDelayMs(): number {
  const hour = beijingHour()
  const weight = globalHourWeight(hour)
  const minMs = Math.round(25_000 + (1 - weight) * 140_000)
  const maxMs = Math.round(75_000 + (1 - weight) * 260_000)
  const jitter = randomFloat() ** 1.6
  return Math.round(minMs + jitter * (maxMs - minMs))
}

/** 单次 tick：随机时刻、随机店铺、随机批量；仅处理「今天」计划，次日自动换新 */
export async function runEngagementSimulationTick(): Promise<void> {
  await onBeijingDayRollover()

  if (!shouldRunTickNow()) return

  const planDate = todayDateKey()
  await ensureDailyEngagementPlans(planDate)

  const pool = getPool()
  const res = await pool.query<PlanRow>(
    `SELECT p.shop_id,
            p.target_visits,
            p.target_followers,
            p.delivered_visits,
            p.delivered_followers
     FROM shop_daily_engagement_plan p
     INNER JOIN shops s ON s.id = p.shop_id AND s.status = 'normal'
     WHERE p.plan_date = $1::date
       AND (p.delivered_visits < p.target_visits OR p.delivered_followers < p.target_followers)
       AND EXISTS (
         SELECT 1 FROM shop_products sp
         WHERE sp.shop_id = p.shop_id AND sp.status = 'on'
       )`,
    [planDate],
  )

  if (res.rows.length === 0) return

  const candidates = shuffle(
    res.rows.filter((plan) => shouldShopReceiveTrafficThisTick(plan.shop_id, plan)),
  )
  if (candidates.length === 0) return

  const batchSize = randomInt(1, Math.min(3, candidates.length))
  const batch = candidates.slice(0, batchSize)

  for (const plan of batch) {
    const { visitDelta, followDelta } = pickChunkForPlan(plan)
    if (visitDelta <= 0 && followDelta <= 0) continue

    let visitsAdded = 0
    if (visitDelta > 0) {
      visitsAdded = await deliverVisitsWithNaturalRhythm(plan.shop_id, planDate, visitDelta)
    }

    const laggedFollow =
      followDelta > 0
        ? followDelta
        : pickFollowBurst(
            {
              ...plan,
              delivered_visits: plan.delivered_visits + visitsAdded,
            },
            0,
          )

    if (laggedFollow > 0) {
      if (visitsAdded > 0 && randomFloat() < 0.55) {
        await sleep(randomInt(800, 4_500))
      }
      await deliverSimulatedEngagement(plan.shop_id, planDate, 0, laggedFollow)
    }

    if (batch.length > 1 && randomFloat() < 0.7) {
      await sleep(randomInt(500, 3_500))
    }
  }
}

/** 常驻 worker：服务启动后永久循环，每个北京时间自然日自动生成新计划并投递 */
export function startEngagementSimulationWorker(): void {
  activePlanDate = todayDateKey()
  scheduleBeijingMidnightRefresh()

  const scheduleNext = () => {
    const delayMs = nextTickDelayMs()
    setTimeout(async () => {
      try {
        await runEngagementSimulationTick()
      } catch (e) {
        console.error('[engagement simulation]', e)
      }
      scheduleNext()
    }, delayMs)
  }

  const initialDelay = randomInt(8_000, 55_000)
  setTimeout(async () => {
    try {
      await runEngagementSimulationTick()
    } catch (e) {
      console.error('[engagement simulation] initial tick', e)
    }
    scheduleNext()
  }, initialDelay)

  console.log('[engagement simulation] daily recurring worker started (beijing calendar day)')
}
