import { z } from 'zod';
const text = z.string().max(8000).nullable().optional();
const positive = z.number().finite().positive().nullable().optional();
const timestamp = z.string().datetime({ offset: true }).nullable().optional();
const status = z.enum(['planned', 'submitted', 'open', 'closed', 'cancelled', 'win', 'loss', 'breakeven', 'reconciliation_required']);
export const journalCreateSchema = z.object({
  instrument: z.enum(['EUR_USD','GBP_USD','USD_JPY','USD_CHF','AUD_USD','NZD_USD','USD_CAD','EUR_GBP','EUR_JPY','GBP_JPY','XAU_USD','US30_USD']),
  direction: z.enum(['long', 'short']), style: z.enum(['scalping','intraday','swing','scalp','position']),
  environment: z.enum(['practice','live']).optional(), accountId: z.string().max(128).nullable().optional(),
  strategyName: text, setupType: text, status: status.optional(),
  entryPrice: positive, stopLoss: positive, takeProfit1: positive, takeProfit2: positive,
  units: z.number().finite().int().min(-100000000).max(100000000).nullable().optional(), lots: positive,
  riskPercent: z.number().finite().min(0).max(100).nullable().optional(), riskAmount: z.number().finite().nonnegative().nullable().optional(),
  pnl: z.number().finite().nullable().optional(), thesis: text, evidence: text, invalidation: text, notes: text,
  openedAt: timestamp, closedAt: timestamp,
  metadata: z.record(z.unknown()).nullable().optional().refine(v => v == null || JSON.stringify(v).length <= 12000, 'Journal metadata is too large.'),
}).refine(v => !v.openedAt || !v.closedAt || Date.parse(v.closedAt) >= Date.parse(v.openedAt), 'The exit cannot precede entry.');
export const journalUpdateSchema = z.object({
  id: z.string().min(1).max(256), status: status.optional(),
  pnl: z.number().finite().nullable().optional(), brokerTradeId: z.string().min(1).max(128).nullable().optional(), notes: text, closedAt: timestamp,
});
