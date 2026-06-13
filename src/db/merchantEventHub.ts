import type { Response } from 'express'

export type MerchantSyncTopic =
  | 'shop'
  | 'dashboard'
  | 'orders'
  | 'wallet'
  | 'warehouse'
  | 'finance'
  | 'promotion'
  | 'all'

export interface MerchantSyncEvent {
  type: 'shop.sync'
  shopId: string
  version: number
  topics: MerchantSyncTopic[]
  ts: string
}

type Subscriber = {
  res: Response
  heartbeat: ReturnType<typeof setInterval>
}

const subscribersByShop = new Map<string, Set<Subscriber>>()

function writeSse(res: Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

export function subscribeMerchantEvents(shopId: string, res: Response): () => void {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  writeSse(res, { type: 'connected', shopId, ts: new Date().toISOString() })

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n')
  }, 25000)

  const sub: Subscriber = { res, heartbeat }
  let set = subscribersByShop.get(shopId)
  if (!set) {
    set = new Set()
    subscribersByShop.set(shopId, set)
  }
  set.add(sub)

  return () => {
    clearInterval(heartbeat)
    set?.delete(sub)
    if (set && set.size === 0) subscribersByShop.delete(shopId)
  }
}

export function publishMerchantSync(
  shopId: string,
  version: number,
  topics: MerchantSyncTopic[] = ['all'],
): void {
  const set = subscribersByShop.get(shopId)
  if (!set || set.size === 0) return

  const event: MerchantSyncEvent = {
    type: 'shop.sync',
    shopId,
    version,
    topics,
    ts: new Date().toISOString(),
  }

  for (const sub of set) {
    try {
      writeSse(sub.res, event)
    } catch {
      clearInterval(sub.heartbeat)
      set.delete(sub)
    }
  }
}
