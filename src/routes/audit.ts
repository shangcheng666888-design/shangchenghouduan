import { Router } from 'express'
import {
  listFundApplicationsForAdmin,
  approveFundApplication,
  rejectFundApplication,
} from '../db/fundApplicationsDb.js'
import {
  listShopFundApplicationsForAdmin,
  approveShopFundApplication,
  rejectShopFundApplication,
} from '../db/shopFundApplicationsDb.js'
import {
  listPendingApplications,
  getApplicationById,
  setApplicationStatus,
} from '../db/shopApplicationsDb.js'
import { nextUserId, getById as getUserById, createUser, updateUser } from '../db/usersDb.js'
import { nextShopId, createShop } from '../db/shopsDb.js'

export const auditRouter = Router()

function omitPassword<T extends { password?: string }>(obj: T): Omit<T, 'password'> {
  const { password: _, ...rest } = obj
  return rest
}

auditRouter.get('/shops', async (_req, res) => {
  try {
    const list = await listPendingApplications()
    res.json({
      list: list.map((item) => ({
        ...omitPassword(item),
        applyAccount: (item as any).applyAccount ?? item.email,
      })),
    })
  } catch (e) {
    console.error('[audit shops list]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

auditRouter.get('/shops/:id', async (req, res) => {
  try {
    const apply = await getApplicationById(req.params.id)
    if (!apply) {
      res.status(404).json({ success: false, message: '申请不存在' })
      return
    }
    res.json(omitPassword(apply))
  } catch (e) {
    console.error('[audit shops get]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

auditRouter.post('/shops/:id/approve', async (req, res) => {
  try {
    const apply = await getApplicationById(req.params.id)
    if (!apply) {
      res.status(404).json({ success: false, message: '申请不存在' })
      return
    }
    if (apply.status !== 'pending') {
      res.status(400).json({ success: false, message: '申请已处理' })
      return
    }
    const shopId = await nextShopId()

    let ownerUserId: string
    const trimmedUserId = apply.userId && typeof apply.userId === 'string' ? apply.userId.trim() : ''
    const email = (apply.email ?? '').trim()

    // 优先使用已有用户；若记录中 userId 无效或对应用户已被删除，则回退到「按邮箱创建新用户」的流程
    if (trimmedUserId) {
      const user = await getUserById(trimmedUserId)
      if (user) {
        ownerUserId = user.id
        await updateUser(user.id, { shopId })
      } else {
        if (!email) {
          res.status(400).json({ success: false, message: '申请缺少登录账号，请用户重新提交入驻申请' })
          return
        }
        const userId = await nextUserId()
        await createUser({
          id: userId,
          account: email,
          password: apply.password,
          balance: 0,
          addresses: [],
          shopId,
          isBot: false,
        })
        ownerUserId = userId
      }
    } else {
      if (!email) {
        res.status(400).json({ success: false, message: '申请缺少登录账号，请用户重新提交入驻申请' })
        return
      }
      const userId = await nextUserId()
      await createUser({
        id: userId,
        account: email,
        password: apply.password,
        balance: 0,
        addresses: [],
        shopId,
        isBot: false,
      })
      ownerUserId = userId
    }
    await createShop({
      id: shopId,
      name: apply.storeName,
      ownerId: ownerUserId,
      status: 'normal',
      logo: apply.logo || null,
      address: apply.storeAddress,
      country: apply.country,
      creditScore: 100,
      walletBalance: 0,
      level: 1,
      followers: 0,
      sales: 0,
      goodRate: 100,
    })
    const updated = await setApplicationStatus(req.params.id, 'approved')
    if (!updated) {
      res.status(400).json({ success: false, message: '申请状态已变更，请刷新' })
      return
    }
    res.json({ success: true, shopId })
  } catch (e) {
    console.error('[audit shops approve]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

auditRouter.post('/shops/:id/reject', async (req, res) => {
  try {
    const apply = await getApplicationById(req.params.id)
    if (!apply) {
      res.status(404).json({ success: false, message: '申请不存在' })
      return
    }
    if (apply.status !== 'pending') {
      res.status(400).json({ success: false, message: '申请已处理' })
      return
    }
    const updated = await setApplicationStatus(req.params.id, 'rejected')
    if (!updated) {
      res.status(400).json({ success: false, message: '申请状态已变更，请刷新' })
      return
    }
    res.json({ success: true })
  } catch (e) {
    console.error('[audit shops reject]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

// ---------- 充值/提现审核 ----------
auditRouter.get('/fund-applications', async (req, res) => {
  try {
    const status = req.query.status as 'pending' | 'approved' | 'rejected' | undefined
    const type = req.query.type === 'recharge' || req.query.type === 'withdraw' ? (req.query.type as 'recharge' | 'withdraw') : undefined
    const keyword = typeof req.query.q === 'string' ? req.query.q.trim() : undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const { list, total } = await listFundApplicationsForAdmin({ status, type, page, pageSize, keyword })
    res.json({ list, total, page, pageSize })
  } catch (e) {
    console.error('[audit fund-applications list]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

auditRouter.post('/fund-applications/:id/approve', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, message: '无效的申请 ID' })
      return
    }
    const reviewerId = (req.body as { reviewerId?: string }).reviewerId
    const result = await approveFundApplication(id, reviewerId)
    if (!result.success) {
      res.status(400).json({ success: false, message: result.message })
      return
    }
    res.json({ success: true, message: '已通过' })
  } catch (e) {
    console.error('[audit fund-applications approve]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

auditRouter.post('/fund-applications/:id/reject', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, message: '无效的申请 ID' })
      return
    }
    const body = req.body as { remark?: string; reviewerId?: string }
    const result = await rejectFundApplication(id, { remark: body.remark, reviewerId: body.reviewerId })
    if (!result.success) {
      res.status(400).json({ success: false, message: result.message })
      return
    }
    res.json({ success: true, message: '已拒绝' })
  } catch (e) {
    console.error('[audit fund-applications reject]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

// ---------- 店铺资金：充值/提现审核 ----------
auditRouter.get('/shop-fund-applications', async (req, res) => {
  try {
    const status = req.query.status as 'pending' | 'approved' | 'rejected' | undefined
    const type =
      req.query.type === 'recharge' || req.query.type === 'withdraw'
        ? (req.query.type as 'recharge' | 'withdraw')
        : undefined
    const keyword = typeof req.query.q === 'string' ? req.query.q.trim() : undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const { list, total } = await listShopFundApplicationsForAdmin({ status, type, page, pageSize, keyword })
    res.json({ list, total, page, pageSize })
  } catch (e) {
    console.error('[audit shop-fund-applications list]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

auditRouter.post('/shop-fund-applications/:id/approve', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, message: '无效的申请 ID' })
      return
    }
    const reviewerId = (req.body as { reviewerId?: string }).reviewerId
    const result = await approveShopFundApplication(id, { reviewerId })
    if (!result.success) {
      res.status(400).json({ success: false, message: result.message })
      return
    }
    res.json({ success: true, message: '已通过' })
  } catch (e) {
    console.error('[audit shop-fund-applications approve]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})

auditRouter.post('/shop-fund-applications/:id/reject', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, message: '无效的申请 ID' })
      return
    }
    const body = req.body as { remark?: string; reviewerId?: string }
    const result = await rejectShopFundApplication(id, { remark: body.remark, reviewerId: body.reviewerId })
    if (!result.success) {
      res.status(400).json({ success: false, message: result.message })
      return
    }
    res.json({ success: true, message: '已拒绝' })
  } catch (e) {
    console.error('[audit shop-fund-applications reject]', e)
    res.status(500).json({ success: false, message: '服务异常' })
  }
})
