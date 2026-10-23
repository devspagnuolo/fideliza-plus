import { db } from './database/db.js';
import { PLAN_FEATURES, tenantPlan } from './plan-catalog.js';

export const REWARD_CHANNELS = ['app', 'site', 'both'] as const;
export type RewardChannel = typeof REWARD_CHANNELS[number];
// SQL fragments: rewards visible to the in-store/App flow and to the site checkout (StoreOS).
export const APP_CHANNEL_SQL = "COALESCE(channel,'both') IN ('app','both')";
export const SITE_CHANNEL_SQL = "COALESCE(channel,'both') IN ('site','both')";

// A store sells on its site when it has an active key that can reserve redemptions at checkout.
export function hasSiteIntegration(tenantId: string) {
  const plan = tenantPlan(tenantId);
  if (!plan || !plan.features.includes(PLAN_FEATURES.ERP_INTEGRATIONS)) return false;
  const keys = db.prepare("SELECT scopes FROM api_keys WHERE tenant_id=? AND active=1 AND (expires_at IS NULL OR expires_at>datetime('now'))").all(tenantId) as { scopes: string }[];
  return keys.some(key => { try { return (JSON.parse(key.scopes) as string[]).includes('rewards:redeem'); } catch { return false; } });
}
