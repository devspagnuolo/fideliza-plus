import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { db } from '../database/db.js';
import { hashToken } from '../security.js';
import { platformMfaRequired } from '../session-security.js';
import { requirePlatformPermission as can } from '../platform-permissions.js';
import { asaasStatus, createAsaasPayment, processAsaasWebhook, runAsaasBillingCycle, setupAsaasWebhook, syncAsaasPayment, verifyAsaasConnection } from '../asaas.js';

export const asaasRoutes = Router();

function auth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.fideliza_platform_session;
  const row = token && db.prepare(`SELECT pa.id adminId,pa.name,pa.email,pa.role,pa.two_factor_enabled twoFactorEnabled FROM platform_sessions ps JOIN platform_admins pa ON pa.id=ps.admin_id
    WHERE ps.token_hash=? AND ps.expires_at>datetime('now') AND pa.active=1`).get(hashToken(token)) as { role: string; twoFactorEnabled: number } | undefined;
  if (!row) return res.status(401).json({ error: 'Administrador não autenticado' });
  if (!row.twoFactorEnabled && platformMfaRequired()) return res.status(403).json({ error: 'Ative o segundo fator (MFA) para acessar o painel da plataforma.', code: 'PLATFORM_MFA_REQUIRED' });
  (req as any).platformAuth = row;
  next();
}

function validWebhookToken(received?: string) {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!received || !expected) return false;
  const left = Buffer.from(received), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

asaasRoutes.post('/webhooks/asaas', (req, res) => {
  if (!validWebhookToken(req.header('asaas-access-token'))) return res.status(401).json({ error: 'Webhook não autenticado' });
  try { res.json(processAsaasWebhook(req.body ?? {})); }
  catch (error) { res.status(422).json({ error: (error as Error).message }); }
});

asaasRoutes.get('/platform/asaas/status', auth,can('platform.read'), (_req, res) => res.json(asaasStatus()));
asaasRoutes.post('/platform/asaas/verify', auth,can('billing.manage'), async (_req, res) => {
  try { res.json(await verifyAsaasConnection()); } catch (error) { res.status(502).json({ error: (error as Error).message }); }
});
asaasRoutes.post('/platform/asaas/webhook/setup', auth,can('billing.manage'), async (_req, res) => {
  try { res.json(await setupAsaasWebhook()); } catch (error) { res.status(502).json({ error: (error as Error).message }); }
});
asaasRoutes.post('/platform/asaas/invoices/:id/generate', auth,can('billing.manage'), async (req, res) => {
  try { res.json(await createAsaasPayment(String(req.params.id))); } catch (error) { res.status(422).json({ error: (error as Error).message }); }
});
asaasRoutes.post('/platform/asaas/invoices/:id/sync', auth,can('billing.manage'), async (req, res) => {
  try { res.json(await syncAsaasPayment(String(req.params.id))); } catch (error) { res.status(422).json({ error: (error as Error).message }); }
});
asaasRoutes.post('/platform/billing/run', auth,can('billing.manage'), async (_req, res) => {
  const result = await runAsaasBillingCycle();
  res.json(result);
});
