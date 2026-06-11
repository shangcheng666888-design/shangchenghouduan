// @ts-nocheck
import { Router } from 'express';
import { getPool } from '../db.js';
import {
    createPromotion,
    getPromotionById,
    getPromotionMetrics,
    launchCampaign,
    listPromotions,
    saveCampaignDraft,
    updatePromotion,
} from '../db/paidPromotionsDb.js';

export const adminPaidPromotionsRouter = Router();

adminPaidPromotionsRouter.get('/', async (req, res) => {
    try {
        const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;
        const list = await listPromotions({ status });
        res.json({ list });
    }
    catch (e) {
        console.error('[admin paid-promotions list]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});

adminPaidPromotionsRouter.post('/', async (req, res) => {
    try {
        const shopId = typeof req.body?.shopId === 'string' ? req.body.shopId.trim() : '';
        const channel = typeof req.body?.channel === 'string' ? req.body.channel.trim() : '';
        const adminNote = typeof req.body?.adminNote === 'string' ? req.body.adminNote.trim() : '';
        if (!shopId || !channel) {
            res.status(400).json({ success: false, message: '请选择店铺与推广渠道' });
            return;
        }
        const pool = getPool();
        const shopRes = await pool.query('SELECT id FROM shops WHERE id = $1', [shopId]);
        if (shopRes.rows.length === 0) {
            res.status(404).json({ success: false, message: '店铺不存在' });
            return;
        }
        const promotion = await createPromotion({
            shopId,
            channel,
            status: 'pending',
            adminNote: adminNote || null,
        });
        res.json({ success: true, promotion });
    }
    catch (e) {
        if (e?.message === 'invalid_channel') {
            res.status(400).json({ success: false, message: '推广渠道无效' });
            return;
        }
        console.error('[admin paid-promotions create]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});

adminPaidPromotionsRouter.patch('/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
            res.status(400).json({ success: false, message: '无效 ID' });
            return;
        }
        const patch = {};
        if (req.body?.channel !== undefined)
            patch.channel = req.body.channel;
        if (req.body?.status !== undefined)
            patch.status = req.body.status;
        if (req.body?.adminNote !== undefined)
            patch.adminNote = req.body.adminNote;
        const promotion = await updatePromotion(id, patch);
        if (!promotion) {
            res.status(404).json({ success: false, message: '推广记录不存在' });
            return;
        }
        res.json({ success: true, promotion });
    }
    catch (e) {
        if (e?.message === 'invalid_channel' || e?.message === 'invalid_status') {
            res.status(400).json({ success: false, message: '参数无效' });
            return;
        }
        console.error('[admin paid-promotions patch]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});

adminPaidPromotionsRouter.put('/:id/campaign-config', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
            res.status(400).json({ success: false, message: '无效 ID' });
            return;
        }
        const promotion = await saveCampaignDraft(id, {
            durationValue: req.body?.durationValue,
            durationUnit: req.body?.durationUnit,
            durationDays: req.body?.durationDays,
            budgetTotal: req.body?.budgetTotal,
            impressions: req.body?.impressions,
            clicks: req.body?.clicks,
            visits: req.body?.visits,
        });
        if (!promotion) {
            res.status(404).json({ success: false, message: '推广记录不存在' });
            return;
        }
        res.json({ success: true, promotion });
    }
    catch (e) {
        if (e?.message === 'promotion_not_awaiting_launch') {
            res.status(400).json({ success: false, message: '商家尚未确认推广，暂不可配置' });
            return;
        }
        if (e?.message === 'clicks_exceed_impressions') {
            res.status(400).json({ success: false, message: '点击量不能大于曝光量' });
            return;
        }
        console.error('[admin paid-promotions campaign-config]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});

adminPaidPromotionsRouter.post('/:id/launch', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
            res.status(400).json({ success: false, message: '无效 ID' });
            return;
        }
        if (req.body && Object.keys(req.body).length > 0) {
            await saveCampaignDraft(id, {
                durationValue: req.body?.durationValue,
                durationUnit: req.body?.durationUnit,
                durationDays: req.body?.durationDays,
                budgetTotal: req.body?.budgetTotal,
                impressions: req.body?.impressions,
                clicks: req.body?.clicks,
                visits: req.body?.visits,
            });
        }
        const promotion = await launchCampaign(id);
        if (!promotion) {
            res.status(404).json({ success: false, message: '推广记录不存在' });
            return;
        }
        const metrics = await getPromotionMetrics(id);
        res.json({ success: true, promotion, metrics });
    }
    catch (e) {
        if (e?.message === 'promotion_not_awaiting_launch') {
            res.status(400).json({ success: false, message: '当前状态不可开启推广' });
            return;
        }
        if (e?.message === 'campaign_config_incomplete') {
            res.status(400).json({ success: false, message: '请先完整填写投放配置' });
            return;
        }
        if (e?.message === 'clicks_exceed_impressions') {
            res.status(400).json({ success: false, message: '点击量不能大于曝光量' });
            return;
        }
        console.error('[admin paid-promotions launch]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});

adminPaidPromotionsRouter.get('/:id/metrics', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
            res.status(400).json({ success: false, message: '无效 ID' });
            return;
        }
        const promotion = await getPromotionById(id);
        if (!promotion) {
            res.status(404).json({ success: false, message: '推广记录不存在' });
            return;
        }
        const metrics = await getPromotionMetrics(id);
        res.json({ promotion, ...metrics });
    }
    catch (e) {
        console.error('[admin paid-promotions metrics get]', e);
        res.status(500).json({ success: false, message: '服务异常' });
    }
});
