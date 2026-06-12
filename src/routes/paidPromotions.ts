// @ts-nocheck
import { Router } from 'express';
import { assertShopOwnerByUserId } from '../db/shopFundApplicationsDb.js';
import {
    getMerchantPromotionByShopId,
    getPromotionMetrics,
    listPromotionHistoryByShopId,
    setPromotionTarget,
    PROMOTION_AUDIENCES,
    PROMOTION_REGIONS,
} from '../db/paidPromotionsDb.js';

export const paidPromotionsRouter = Router();

paidPromotionsRouter.get('/paid-promotion/options', (_req, res) => {
    res.json({
        regions: PROMOTION_REGIONS,
        audiences: PROMOTION_AUDIENCES,
    });
});

paidPromotionsRouter.get('/shops/:shopId/paid-promotion/history', async (req, res) => {
    try {
        const shopId = req.params.shopId;
        const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
        if (!userId) {
            res.status(400).json({ success: false, message: '缺少 userId' });
            return;
        }
        const auth = await assertShopOwnerByUserId(shopId, userId);
        if (!auth.ok) {
            res.status(403).json({ success: false, message: auth.message ?? '无权限' });
            return;
        }
        const list = await listPromotionHistoryByShopId(shopId);
        res.json({ list });
    }
    catch (e) {
        console.error('[paid-promotion history GET]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});

paidPromotionsRouter.get('/shops/:shopId/paid-promotion', async (req, res) => {
    try {
        const shopId = req.params.shopId;
        const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
        if (!userId) {
            res.status(400).json({ success: false, message: '缺少 userId' });
            return;
        }
        const auth = await assertShopOwnerByUserId(shopId, userId);
        if (!auth.ok) {
            res.status(403).json({ success: false, message: auth.message ?? '无权限' });
            return;
        }
        const promotion = await getMerchantPromotionByShopId(shopId);
        if (!promotion) {
            res.json({ active: false, promotion: null, metrics: null });
            return;
        }
        const metrics = ['active', 'paused', 'completed'].includes(promotion.status)
            ? await getPromotionMetrics(promotion.id)
            : null;
        res.json({
            active: true,
            promotion,
            metrics,
            targetSelected: Boolean(promotion.merchantConfirmedAt),
            regions: PROMOTION_REGIONS,
            audiences: PROMOTION_AUDIENCES,
        });
    }
    catch (e) {
        console.error('[paid-promotion GET]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});

paidPromotionsRouter.patch('/shops/:shopId/paid-promotion', async (req, res) => {
    try {
        const shopId = req.params.shopId;
        const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
        const targetType = req.body?.targetType;
        const targetListingId = req.body?.targetListingId;
        const targetRegion = req.body?.targetRegion;
        const targetAudience = req.body?.targetAudience ?? req.body?.targetAudiences;
        if (!userId) {
            res.status(400).json({ success: false, message: '缺少 userId' });
            return;
        }
        const auth = await assertShopOwnerByUserId(shopId, userId);
        if (!auth.ok) {
            res.status(403).json({ success: false, message: auth.message ?? '无权限' });
            return;
        }
        const promotion = await getMerchantPromotionByShopId(shopId);
        if (!promotion) {
            res.status(404).json({ success: false, message: '当前店铺未开启付费推广' });
            return;
        }
        const updated = await setPromotionTarget(promotion.id, {
            targetType,
            targetListingId,
            targetRegion,
            targetAudience,
        });
        res.json({
            success: true,
            promotion: updated,
            metrics: null,
            targetSelected: Boolean(updated?.merchantConfirmedAt),
        });
    }
    catch (e) {
        if (e?.message === 'invalid_target_type') {
            res.status(400).json({ success: false, message: '推广目标类型无效' });
            return;
        }
        if (e?.message === 'listing_required') {
            res.status(400).json({ success: false, message: '请选择要推广的商品' });
            return;
        }
        if (e?.message === 'region_required') {
            res.status(400).json({ success: false, message: '请选择推广地区' });
            return;
        }
        if (e?.message === 'audience_required') {
            res.status(400).json({ success: false, message: '请选择受众群体' });
            return;
        }
        if (e?.message === 'audience_invalid') {
            res.status(400).json({ success: false, message: '受众群体选择无效' });
            return;
        }
        if (e?.message === 'listing_not_found') {
            res.status(400).json({ success: false, message: '商品不存在或未上架' });
            return;
        }
        if (e?.message === 'promotion_not_editable') {
            res.status(400).json({ success: false, message: '当前推广已进入投放阶段，无法修改' });
            return;
        }
        console.error('[paid-promotion PATCH]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
