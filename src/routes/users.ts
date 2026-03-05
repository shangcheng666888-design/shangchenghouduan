import { Router } from 'express'
import { getById, listUsers, updateUser, listFundLogs, insertFundLog, type FundLogType } from '../db/usersDb.js'
import { createFundApplication, listFundApplicationsByUser } from '../db/fundApplicationsDb.js'
import {
  addFavorite,
  removeFavorite,
  listFavorites,
  isFavorited,
  addFollowedShop,
  removeFollowedShop,
  listFollowedShops,
  isShopFollowed,
} from '../db/favoritesDb.js'

export const usersRouter = Router()

usersRouter.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30))
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined
    const status = req.query.status === 'disabled' || req.query.status === 'normal' ? (req.query.status as 'normal' | 'disabled') : undefined
    const { list, total } = await listUsers({ page, pageSize, search, status })
    res.json({ list, total, page, pageSize })
  } catch (e) {
    console.error('[users list]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

usersRouter.get('/:id', async (req, res) => {
  try {
    const user = await getById(req.params.id)
    if (!user) {
      res.status(404).json({ success: false, message: '用户不存在' })
      return
    }
    res.json({
      id: user.id,
      account: user.account,
      balance: user.balance,
      password: user.password,
      tradePassword: user.tradePassword ?? undefined,
      hasTradePassword: !!(user.tradePassword && user.tradePassword.length > 0),
      addresses: user.addresses ?? [],
      shopId: user.shopId,
      isBot: user.isBot ?? false,
      status: user.status ?? 'normal',
      avatar: user.avatar ?? null,
      createdAt: user.createdAt,
    })
  } catch (e) {
    console.error('[users get]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

usersRouter.patch('/:id', async (req, res) => {
  try {
    const user = await getById(req.params.id)
    if (!user) {
      res.status(404).json({ success: false, message: '用户不存在' })
      return
    }
    const body = req.body as Record<string, unknown> & { oldTradePassword?: string; fromAdmin?: boolean }
    const updates: Parameters<typeof updateUser>[1] = {}
    if (typeof body.balance === 'number') updates.balance = body.balance
    if (body.tradePassword !== undefined) {
      const isAdminUpdate = body.fromAdmin === true
      if (!isAdminUpdate) {
        if (user.tradePassword && (typeof body.oldTradePassword !== 'string' || body.oldTradePassword !== user.tradePassword)) {
          res.status(400).json({ success: false, message: '旧交易密码错误' })
          return
        }
      }
      updates.tradePassword = typeof body.tradePassword === 'string' ? body.tradePassword : ''
    }
    if (typeof body.password === 'string') updates.password = body.password
    if (Array.isArray(body.addresses)) updates.addresses = body.addresses
    if (typeof body.shopId === 'string' || body.shopId === null) updates.shopId = body.shopId
    if (typeof body.isBot === 'boolean') updates.isBot = body.isBot
    if (body.status === 'normal' || body.status === 'disabled') updates.status = body.status
    if (body.avatar !== undefined) updates.avatar = typeof body.avatar === 'string' ? body.avatar : null
    await updateUser(req.params.id, updates)
    res.json({ success: true })
  } catch (e) {
    console.error('[users patch]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 修改登录密码：需验证旧密码 */
usersRouter.post('/:id/change-password', async (req, res) => {
  try {
    const user = await getById(req.params.id)
    if (!user) {
      res.status(404).json({ success: false, message: '用户不存在' })
      return
    }
    const body = req.body as { oldPassword?: string; newPassword?: string }
    if (typeof body.oldPassword !== 'string' || !body.oldPassword) {
      res.status(400).json({ success: false, message: '请输入旧密码' })
      return
    }
    if (body.oldPassword !== user.password) {
      res.status(400).json({ success: false, message: '旧密码错误' })
      return
    }
    if (typeof body.newPassword !== 'string' || !body.newPassword) {
      res.status(400).json({ success: false, message: '请输入新密码' })
      return
    }
    const pwdRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,22}$/
    if (!pwdRegex.test(body.newPassword)) {
      res.status(400).json({ success: false, message: '新密码需为 6-22 位字母和数字组合' })
      return
    }
    await updateUser(req.params.id, { password: body.newPassword })
    res.json({ success: true })
  } catch (e) {
    console.error('[users change-password]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 充值申请：校验交易密码后提交，等待后台审核通过后到账 */
usersRouter.post('/:id/recharge', async (req, res) => {
  try {
    const user = await getById(req.params.id)
    if (!user) {
      res.status(404).json({ success: false, message: '用户不存在' })
      return
    }
    const body = req.body as { amount?: number; tradePassword?: string; transactionNo?: string }
    const tradePassword = typeof body.tradePassword === 'string' ? body.tradePassword : ''
    if (!user.tradePassword) {
      res.status(400).json({ success: false, message: '请先设置交易密码' })
      return
    }
    if (tradePassword !== user.tradePassword) {
      res.status(400).json({ success: false, message: '交易密码错误' })
      return
    }
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ success: false, message: '请填写正确金额' })
      return
    }
    const transactionNo = typeof body.transactionNo === 'string' ? body.transactionNo.trim() : ''
    if (!transactionNo) {
      res.status(400).json({ success: false, message: '请填写交易号' })
      return
    }
    const { id } = await createFundApplication({
      userId: req.params.id,
      type: 'recharge',
      amount,
      rechargeTxNo: transactionNo,
    })
    res.status(201).json({ success: true, applicationId: id, message: '已提交，请等待审核通过后到账' })
  } catch (e) {
    console.error('[users recharge]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 提现申请：校验交易密码后提交，等待后台审核通过后扣款 */
usersRouter.post('/:id/withdraw', async (req, res) => {
  try {
    const user = await getById(req.params.id)
    if (!user) {
      res.status(404).json({ success: false, message: '用户不存在' })
      return
    }
    const body = req.body as { amount?: number; tradePassword?: string; address?: string }
    const tradePassword = typeof body.tradePassword === 'string' ? body.tradePassword : ''
    if (!user.tradePassword) {
      res.status(400).json({ success: false, message: '请先设置交易密码' })
      return
    }
    if (tradePassword !== user.tradePassword) {
      res.status(400).json({ success: false, message: '交易密码错误' })
      return
    }
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ success: false, message: '请填写正确金额' })
      return
    }
    const address = typeof body.address === 'string' ? body.address.trim() : ''
    if (!address) {
      res.status(400).json({ success: false, message: '请填写提现地址' })
      return
    }
    if (user.balance < amount) {
      res.status(400).json({ success: false, message: '余额不足' })
      return
    }
    const { id } = await createFundApplication({
      userId: req.params.id,
      type: 'withdraw',
      amount,
      withdrawAddress: address,
    })
    res.status(201).json({ success: true, applicationId: id, message: '已提交，请等待审核通过后打款' })
  } catch (e) {
    console.error('[users withdraw]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 用户查看自己的充值/提现申请列表（待审核、通过、拒绝） */
usersRouter.get('/:id/fund-applications', async (req, res) => {
  try {
    const userId = req.params.id
    const status = req.query.status as 'pending' | 'approved' | 'rejected' | undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const { list, total } = await listFundApplicationsByUser(userId, { status, page, pageSize })
    res.json({ list, total, page, pageSize })
  } catch (e) {
    console.error('[users fund-applications]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 个人中心：查询当前用户的资金变动记录（充值、提现、消费、退款），每条带唯一订单号 orderNo */
usersRouter.get('/:id/fund-logs', async (req, res) => {
  try {
    const userId = req.params.id
    const type = req.query.type as FundLogType | undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const { list, total } = await listFundLogs(userId, { type, page, pageSize })
    const listWithOrderNo = list.map((item) => {
      const orderNo = item.orderCode || item.relatedId || String(item.id)
      const orderCategory = item.type === 'recharge' || item.type === 'withdraw' ? 'fund' : 'shopping'
      return { ...item, orderNo, orderCategory }
    })
    res.json({ list: listWithOrderNo, total, page, pageSize })
  } catch (e) {
    console.error('[users fund-logs]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

function isTableMissing(e: unknown): boolean {
  const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
  return code === '42P01'
}

/** 是否已收藏某商品（供前端校验，须在 /:id/favorites 之前） */
usersRouter.get('/:id/favorites/check/:itemId', async (req, res) => {
  try {
    const decoded = decodeURIComponent(req.params.itemId)
    const ok = await isFavorited(req.params.id, decoded)
    res.json({ favorited: ok })
  } catch (e: unknown) {
    if (isTableMissing(e)) {
      console.warn('[users favorites] 表不存在，请执行: node scripts/run-migration.js 006')
      return res.json({ favorited: false })
    }
    console.error('[users favorites check]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 商品收藏：列表 */
usersRouter.get('/:id/favorites', async (req, res) => {
  try {
    const list = await listFavorites(req.params.id)
    res.json({ list })
  } catch (e: unknown) {
    if (isTableMissing(e)) {
      console.warn('[users favorites] 表不存在，请执行: node scripts/run-migration.js 006')
      return res.json({ list: [] })
    }
    console.error('[users favorites list]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 商品收藏：添加（点击五角星收藏，传 itemId 与展示快照） */
usersRouter.post('/:id/favorites', async (req, res) => {
  try {
    const body = req.body as { itemId?: string; title?: string; image?: string; price?: string; subtitle?: string; shopId?: string }
    if (!body?.itemId) {
      res.status(400).json({ success: false, message: '缺少 itemId' })
      return
    }
    await addFavorite({
      userId: req.params.id,
      itemId: String(body.itemId),
      title: body.title,
      image: body.image,
      price: body.price,
      subtitle: body.subtitle,
      shopId: body.shopId,
    })
    res.status(201).json({ success: true })
  } catch (e: unknown) {
    if (isTableMissing(e)) {
      console.warn('[users favorites] 表不存在，请执行: node scripts/run-migration.js 006')
      return res.status(201).json({ success: true })
    }
    console.error('[users favorites add]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 商品收藏：取消（按 itemId 删除） */
usersRouter.delete('/:id/favorites/:itemId', async (req, res) => {
  try {
    const decoded = decodeURIComponent(req.params.itemId)
    await removeFavorite(req.params.id, decoded)
    res.json({ success: true })
  } catch (e: unknown) {
    if (isTableMissing(e)) {
      console.warn('[users favorites] 表不存在，请执行: node scripts/run-migration.js 006')
      return res.json({ success: true })
    }
    console.error('[users favorites remove]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 关注店铺：列表 */
usersRouter.get('/:id/followed-shops', async (req, res) => {
  try {
    const list = await listFollowedShops(req.params.id)
    res.json({ list })
  } catch (e: unknown) {
    if (isTableMissing(e)) {
      console.warn('[users followed-shops] 表不存在，请执行: node scripts/run-migration.js 006')
      return res.json({ list: [] })
    }
    console.error('[users followed-shops list]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 关注店铺：添加 */
usersRouter.post('/:id/followed-shops', async (req, res) => {
  try {
    const body = req.body as { shopId?: string; shopName?: string }
    if (!body?.shopId) {
      res.status(400).json({ success: false, message: '缺少 shopId' })
      return
    }
    await addFollowedShop({
      userId: req.params.id,
      shopId: String(body.shopId),
      shopName: body.shopName,
    })
    res.status(201).json({ success: true })
  } catch (e) {
    console.error('[users followed-shops add]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})

/** 关注店铺：取消关注 */
usersRouter.delete('/:id/followed-shops/:shopId', async (req, res) => {
  try {
    const decoded = decodeURIComponent(req.params.shopId)
    await removeFollowedShop(req.params.id, decoded)
    res.json({ success: true })
  } catch (e) {
    console.error('[users followed-shops remove]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})
