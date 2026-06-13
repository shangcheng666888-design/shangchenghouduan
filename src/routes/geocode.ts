// @ts-nocheck
import { Router } from 'express'
import fetch from 'node-fetch'
import { lookupCountryCentroid } from '../utils/countryCentroids.js'

export const geocodeRouter = Router()

async function nominatimSearch(q: string) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'shangcheng-merchant-console/1.0 (shop settings geocode)',
      Accept: 'application/json',
    },
  })
  if (!resp.ok) return null
  const data = await resp.json()
  if (!Array.isArray(data) || data.length === 0) return null
  const hit = data[0]
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    label: typeof hit.display_name === 'string' ? hit.display_name : q,
  }
}

/** 地址 → 经纬度（Nominatim 代理，供商家设置页地球定位） */
geocodeRouter.get('/', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const country = typeof req.query.country === 'string' ? req.query.country.trim() : ''
    if (!q) {
      res.status(400).json({ success: false, message: '缺少查询地址' })
      return
    }
    if (q.length > 240) {
      res.status(400).json({ success: false, message: '地址过长' })
      return
    }

    let hit = await nominatimSearch(q)
    if (!hit && country) {
      hit = await nominatimSearch(`${q}, ${country}`)
    }
    if (!hit) {
      const centroid = lookupCountryCentroid(country) ?? lookupCountryCentroid(q)
      if (centroid) {
        res.json({
          success: true,
          lat: centroid.lat,
          lng: centroid.lng,
          label: country || centroid.labelZh,
          approximate: true,
        })
        return
      }
    }
    if (!hit) {
      res.json({ success: false, message: '未找到对应位置' })
      return
    }

    res.json({
      success: true,
      lat: hit.lat,
      lng: hit.lng,
      label: hit.label,
      approximate: false,
    })
  } catch (e) {
    console.error('[geocode]', e)
    res.status(500).json({ success: false, message: '地理编码失败' })
  }
})
