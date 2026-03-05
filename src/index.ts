import 'dotenv/config'
import path from 'path'
import express from 'express'
import cors from 'cors'
import { verifyAdminToken } from './adminSession.js'
import { authRouter } from './routes/auth.js'
import { adminAuthRouter } from './routes/adminAuth.js'
import { usersRouter } from './routes/users.js'
import { shopsRouter } from './routes/shops.js'
import { productsRouter } from './routes/products.js'
import { categoriesRouter } from './routes/categories.js'
import { shopProductsRouter } from './routes/shopProducts.js'
import { listingsRouter } from './routes/listings.js'
import { ordersRouter } from './routes/orders.js'
import { cartRouter } from './routes/cart.js'
import { auditRouter } from './routes/audit.js'
import { shopApplicationsRouter } from './routes/shopApplications.js'
import { uploadRouter } from './routes/upload.js'
import { adminDashboardRouter } from './routes/adminDashboard.js'
import { platformPaymentConfigRouter } from './routes/platformPaymentConfig.js'
import { adminPlatformPaymentConfigRouter } from './routes/adminPlatformPaymentConfig.js'
import { homeRouter } from './routes/home.js'
import { adminHomeFeaturedRouter } from './routes/adminHomeFeatured.js'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '10mb' }))
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

app.use('/api/auth', authRouter)
app.use('/api/admin', (req, res, next) => {
  if (req.path.startsWith('/auth')) return next()
  const auth = req.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null
  if (!token || !verifyAdminToken(token)) {
    res.status(401).json({ success: false, message: '未登录或登录已过期，请重新登录' })
    return
  }
  next()
})
app.use('/api/admin/auth', adminAuthRouter)
app.use('/api/users', usersRouter)
app.use('/api/shops', shopsRouter)
app.use('/api/products', productsRouter)
app.use('/api/categories', categoriesRouter)
app.use('/api/shop-products', shopProductsRouter)
app.use('/api/listings', listingsRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/cart', cartRouter)
app.use('/api/audit', auditRouter)
app.use('/api/shop-applications', shopApplicationsRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/platform-payment-config', platformPaymentConfigRouter)
app.use('/api/home', homeRouter)
app.use('/api/admin/dashboard', adminDashboardRouter)
app.use('/api/admin/platform-payment-config', adminPlatformPaymentConfigRouter)
app.use('/api/admin/home-featured', adminHomeFeaturedRouter)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`[backend] http://localhost:${PORT}`)
})
