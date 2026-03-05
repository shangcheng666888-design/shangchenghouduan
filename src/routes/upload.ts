import path from 'path'
import fs from 'fs'
import { Router, type Request } from 'express'
import multer from 'multer'
import { createClient } from '@supabase/supabase-js'
import { verifyAdminToken } from '../adminSession.js'

export const uploadRouter = Router()

const BUCKET = process.env.BUCKET ?? 'shangcheng'
const BUCKET_COMMODITY = process.env.BUCKET_COMMODITY ?? 'commodity'
const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? ''
const useBucket = !!(SUPABASE_URL && SUPABASE_KEY && (BUCKET || BUCKET_COMMODITY))

const supabase = useBucket ? createClient(SUPABASE_URL, SUPABASE_KEY) : null

/**
 * 若 url 为本项目 Supabase 桶的公网地址，则从桶中删除该对象（用于更换 logo/横幅时删旧图）。
 */
export async function deleteStorageObjectIfOurs(url: string | null | undefined): Promise<void> {
  if (!url || typeof url !== 'string') return
  const u = url.trim()
  if (!u) return
  if (!supabase) return
  // 公网 URL 形如: https://xxx.supabase.co/storage/v1/object/public/BUCKET/path/to/file
  const match = u.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
  if (!match) return
  const [, bucketName, objectPath] = match
  if (!bucketName || !objectPath) return
  try {
    const { error } = await supabase.storage.from(bucketName).remove([decodeURIComponent(objectPath)])
    if (error) console.error('[upload deleteStorageObjectIfOurs]', error)
  } catch (e) {
    console.error('[upload deleteStorageObjectIfOurs]', e)
  }
}

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')
if (!useBucket) {
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  } catch {
    // ignore
  }
}

const memoryStorage = multer.memoryStorage()
const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg'
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`
    cb(null, name)
  },
})

const upload = multer({
  storage: useBucket ? memoryStorage : diskStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype)
    if (ok) cb(null, true)
    else cb(new Error('仅支持图片：JPEG/PNG/GIF/WebP'))
  },
})

uploadRouter.post('/', (req: Request, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      res.status(400).json({ success: false, message: err instanceof Error ? err.message : '上传失败' })
      return
    }
    const body = (req as Request & { body?: { bucket?: string } }).body
    if (body?.bucket === 'commodity') {
      const auth = req.headers.authorization
      const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null
      if (!token || !verifyAdminToken(token)) {
        res.status(401).json({ success: false, message: '未登录或登录已过期，请重新登录' })
        return
      }
    }
    const file = (req as Request & { file?: multer.Multer.File & { filename?: string } }).file
    if (!file) {
      res.status(400).json({ success: false, message: '未选择文件' })
      return
    }

    if (useBucket && supabase && file.buffer) {
      const bucketName = (req.body as { bucket?: string })?.bucket === 'commodity' ? BUCKET_COMMODITY : BUCKET
      const ext = path.extname(file.originalname) || '.jpg'
      const objectPath = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`
      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false })
      if (error) {
        console.error('[upload supabase]', error)
        res.status(500).json({ success: false, message: error.message || '上传到存储桶失败' })
        return
      }
      const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(data.path)
      res.json({ success: true, url: urlData.publicUrl })
      return
    }

    const base = `${req.protocol}://${req.get('host') ?? ''}`
    const url = `${base}/uploads/${(file as multer.Multer.File & { filename: string }).filename}`
    res.json({ success: true, url })
  })
})
