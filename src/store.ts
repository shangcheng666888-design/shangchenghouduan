/**
 * 内存存储，便于前后端联调。后续可替换为数据库。
 *
 * 余额与钱包为两套独立体系，互不影响：
 * - 用户 balance：商城客户（买家）余额，用于下单支付、充值、提现等。
 * - 店铺 walletBalance：店铺钱包余额，用于收款、提现等，与用户余额完全分离。
 */

export interface User {
  id: string
  account: string
  password: string
  /** 商城客户（买家）余额，与店铺钱包无关 */
  balance: number
  tradePassword?: string
  addresses: Array<{ id: string; name: string; phone: string; region: string; address: string }>
  shopId: string | null
  createdAt: string
}

export interface Shop {
  id: string
  name: string
  ownerId: string
  status: 'normal' | 'banned'
  creditScore: number
  /** 店铺钱包余额，与用户（买家）余额为两套体系 */
  walletBalance: number
  level: number
  followers: number
  sales: number
  goodRate: number
  createdAt: string
}

export interface ShopApply {
  id: string
  storeName: string
  storeAddress: string
  country: string
  idNumber: string
  realName: string
  email: string
  invitationCode: string
  applyTime: string
  logo: string
  idFront: string
  idBack: string
  idHandheld: string
  signature: string
  status: 'pending' | 'approved' | 'rejected'
}

export interface Product {
  id: string
  shopId: string
  title: string
  image: string
  price: number
  category: string
  subCategory: string
  status: 'on' | 'off'
  sales: number
  createdAt: string
}

/** 订单状态：待支付 -> 已支付/待发货 -> 已发货 -> 已完成；可取消 */
export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'completed' | 'cancelled'

export interface OrderItemSnapshot {
  id: string
  title: string
  price: number
  quantity: number
  image?: string
  spec?: string
}

export interface OrderAddressSnapshot {
  recipient: string
  phoneCode: string
  phone: string
  country: string
  province: string
  city: string
  postal: string
  detail: string
}

export interface Order {
  id: string
  orderNumber: string
  shopId: string
  userId: string
  amount: number
  status: OrderStatus
  trackingNo?: string
  items: OrderItemSnapshot[]
  address: OrderAddressSnapshot
  createdAt: string
}

const users = new Map<string, User>()
const shops = new Map<string, Shop>()
const shopApplies = new Map<string, ShopApply>()
const products = new Map<string, Product>()
const orders = new Map<string, Order>()

// 种子数据
const seedUser: User = {
  id: 'U1',
  account: 'buyer@test.com',
  password: 'abc123',
  balance: 1000,
  tradePassword: '123456',
  addresses: [{ id: 'A1', name: '张三', phone: '13800138000', region: '北京市-朝阳区', address: '某某路 1 号' }],
  shopId: null,
  createdAt: new Date().toISOString(),
}
users.set(seedUser.id, seedUser)

const seedShop: Shop = {
  id: '001ABC',
  name: '测试店铺',
  ownerId: 'U1',
  status: 'normal',
  creditScore: 95,
  walletBalance: 5000,
  level: 3,
  followers: 120,
  sales: 880,
  goodRate: 98.5,
  createdAt: new Date().toISOString(),
}
shops.set(seedShop.id, seedShop)

export const store = {
  users,
  shops,
  shopApplies,
  products,
  orders,
}
