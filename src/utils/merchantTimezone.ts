import type { Pool } from 'pg'

const FALLBACK_TZ = 'UTC'
const TZ_PATTERN = /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)+$/

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export type LocalDayPoint = {
  key: string
  labelZh: string
  labelEn: string
}

/** 校验 IANA 时区名，防止 SQL 注入；无效则回退 UTC */
export function resolveMerchantTimezone(input: unknown): string {
  if (typeof input !== 'string') return FALLBACK_TZ
  const tz = input.trim()
  if (!TZ_PATTERN.test(tz) || tz.length > 64) return FALLBACK_TZ
  return tz
}

/** 商家本地时区下连续 N 个自然日（含今天），用于趋势图对齐 */
export async function getMerchantLocalDaySeries(
  pool: Pool,
  timezone: string,
  dayCount = 7,
): Promise<LocalDayPoint[]> {
  const tz = resolveMerchantTimezone(timezone)
  const res = await pool.query<{ day_key: string; dow: string }>(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day_key,
            EXTRACT(DOW FROM d)::int::text AS dow
     FROM generate_series(
       ((NOW() AT TIME ZONE $1)::date - ($2::int - 1)),
       (NOW() AT TIME ZONE $1)::date,
       INTERVAL '1 day'
     ) AS d
     ORDER BY d ASC`,
    [tz, dayCount],
  )
  return res.rows.map((row) => {
    const dow = Number(row.dow)
    return {
      key: row.day_key,
      labelZh: WEEKDAY_ZH[dow] ?? row.day_key,
      labelEn: WEEKDAY_EN[dow] ?? row.day_key,
    }
  })
}
