import { Router } from 'express'
import { getByAccount } from '../db/usersDb.js'
import { nextApplicationId, createShopApplication } from '../db/shopApplicationsDb.js'

export const shopApplicationsRouter = Router()

/** 商家入驻：提交申请，写入数据库，待管理员审核 */
shopApplicationsRouter.post('/', async (req, res) => {
  try {
    const body = req.body as {
      storeName?: string
      storeAddress?: string
      country?: string
      idNumber?: string
      realName?: string
      email?: string
      password?: string
      invitationCode?: string
      logo?: string | null
      idFront?: string | null
      idBack?: string | null
      idHandheld?: string | null
      signature?: string | null
      userId?: string
    }
    if (!body.storeName?.trim() || !body.storeAddress?.trim() || !body.country?.trim()) {
      res.status(400).json({ success: false, message: '请填写完整的商业信息' })
      return
    }
    // 主体信息：证件号与真实姓名为必填，邮箱改为可选
    if (!body.idNumber?.trim() || !body.realName?.trim()) {
      res.status(400).json({ success: false, message: '请填写完整的主体信息' })
      return
    }
    // 登录密码改为可选：如果填写了则做基本长度校验，否则允许为空
    if (typeof body.password === 'string' && body.password.trim() && body.password.trim().length < 6) {
      res.status(400).json({ success: false, message: '登录密码至少 6 位' })
      return
    }

    const email = typeof body.email === 'string' ? body.email.trim() : ''
    if (email) {
      const existing = await getByAccount(email)
      if (existing) {
        res.status(409).json({ success: false, message: '该邮箱已注册，请直接登录或使用其他邮箱' })
        return
      }
    }
    const id = await nextApplicationId()
    await createShopApplication({
      id,
      storeName: String(body.storeName).trim(),
      storeAddress: String(body.storeAddress).trim(),
      country: String(body.country).trim(),
      idNumber: String(body.idNumber).trim(),
      realName: String(body.realName).trim(),
      email,
      password: body.password ? String(body.password) : '',
      invitationCode: body.invitationCode?.trim() ?? '',
      logo: body.logo ?? null,
      idFront: body.idFront ?? null,
      idBack: body.idBack ?? null,
      idHandheld: body.idHandheld ?? null,
      signature: body.signature ?? null,
      userId: typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : null,
    })
    res.status(201).json({ success: true, applicationId: id, message: '申请已提交，请等待审核' })
  } catch (e) {
    console.error('[shop-applications submit]', e)
    res.status(500).json({ success: false, message: '服务异常，请稍后重试' })
  }
})
