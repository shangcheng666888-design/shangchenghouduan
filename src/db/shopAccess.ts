import { getShopById } from './shopsDb.js'
import { assertShopOwnerByUserId } from './shopFundApplicationsDb.js'

const SHOP_BANNED_MESSAGE = '店铺已被封禁，相关经营功能已暂停，请联系客服申诉'

type AuthOk = { ok: true }
type AuthFail = { ok: false; code?: string; message: string }

/** 校验店铺未封禁 */
export async function assertShopActive(shopId: string): Promise<AuthOk | AuthFail> {
  const shop = await getShopById(shopId)
  if (!shop) {
    return { ok: false, message: '店铺不存在' }
  }
  if (shop.status === 'banned') {
    return { ok: false, code: 'SHOP_BANNED', message: SHOP_BANNED_MESSAGE }
  }
  return { ok: true }
}

/** 商家写操作：校验店主身份且店铺未封禁 */
export async function assertShopOwnerForWrite(shopId: string, userId: string): Promise<AuthOk | AuthFail> {
  const auth = await assertShopOwnerByUserId(shopId, userId)
  if (!auth.ok) {
    return auth
  }
  return assertShopActive(shopId)
}
