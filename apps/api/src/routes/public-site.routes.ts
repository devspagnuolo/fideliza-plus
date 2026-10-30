import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { asaasStatus, createAsaasTrialCheckout, ensureAsaasCustomer } from '../asaas.js';
import { captchaPublicConfig, verifyCaptcha } from '../captcha.js';
import { config } from '../config.js';
import { db } from '../database/db.js';
import { planByCode, publicPlanCatalog } from '../plan-catalog.js';
import { hashPassword, hashToken, secureStringEqual } from '../security.js';
import { SOFTWARE_LICENSE_CONTRACT_EFFECTIVE_DATE, SOFTWARE_LICENSE_CONTRACT_HASH, SOFTWARE_LICENSE_CONTRACT_SECTIONS, SOFTWARE_LICENSE_CONTRACT_SNAPSHOT, SOFTWARE_LICENSE_CONTRACT_TITLE, SOFTWARE_LICENSE_CONTRACT_VERSION } from '../legal/software-license-contract.js';

export const publicSiteRoutes = Router();
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const asText = (value: unknown) => String(value ?? '').trim();
const maskEmail = (value: string) => { const [user = '', domain = ''] = value.split('@'); return `${user.slice(0, 2)}***@${domain}`; };

async function brasilApi(path: string) {
  const response = await fetch(`https://brasilapi.com.br/api/${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) throw new Error('NOT_FOUND');
  if (!response.ok) throw new Error('BRASIL_API_UNAVAILABLE');
  return response.json() as Promise<Record<string, any>>;
}

publicSiteRoutes.get('/public/plans', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  const billing=asaasStatus();
  res.json({ trialDays: 7, plans: publicPlanCatalog(), billing: { gateway: 'asaas', configured: billing.configured, enabled: billing.billingEnabled }, captcha: captchaPublicConfig() });
});

publicSiteRoutes.get('/public/software-license-contract',(_req,res)=>{
  res.set('Cache-Control','public, max-age=300');
  res.json({title:SOFTWARE_LICENSE_CONTRACT_TITLE,version:SOFTWARE_LICENSE_CONTRACT_VERSION,effectiveDate:SOFTWARE_LICENSE_CONTRACT_EFFECTIVE_DATE,hash:SOFTWARE_LICENSE_CONTRACT_HASH,sections:SOFTWARE_LICENSE_CONTRACT_SECTIONS});
});

publicSiteRoutes.get('/public/cnpj/:cnpj', async (req, res) => {
  const cnpj = digits(req.params.cnpj);
  if (cnpj.length !== 14) return res.status(400).json({ error: 'Informe um CNPJ com 14 dígitos' });
  try {
    const item = await brasilApi(`cnpj/v1/${cnpj}`);
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ cnpj, companyName: asText(item.nome_fantasia) || asText(item.razao_social), legalName: asText(item.razao_social),
      email: asText(item.email).toLowerCase(), phone: digits(item.ddd_telefone_1), postalCode: digits(item.cep), address: asText(item.logradouro),
      addressNumber: asText(item.numero), complement: asText(item.complemento), district: asText(item.bairro), city: asText(item.municipio), state: asText(item.uf) });
  } catch (error) {
    const code = (error as Error).message;
    res.status(code === 'NOT_FOUND' ? 404 : 502).json({ error: code === 'NOT_FOUND' ? 'CNPJ não encontrado na Receita Federal' : 'A consulta de CNPJ está temporariamente indisponível' });
  }
});

publicSiteRoutes.get('/public/cep/:cep', async (req, res) => {
  const cep = digits(req.params.cep);
  if (cep.length !== 8) return res.status(400).json({ error: 'Informe um CEP com 8 dígitos' });
  try {
    const item = await brasilApi(`cep/v2/${cep}`);
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ postalCode: digits(item.cep), address: asText(item.street), district: asText(item.neighborhood), city: asText(item.city), state: asText(item.state) });
  } catch (error) {
    const code = (error as Error).message;
    res.status(code === 'NOT_FOUND' ? 404 : 502).json({ error: code === 'NOT_FOUND' ? 'CEP não encontrado' : 'A consulta de CEP está temporariamente indisponível' });
  }
});

const trialSchema = z.object({
  planCode: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/), companyName: z.string().trim().min(2).max(140), legalName: z.string().trim().min(2).max(180),
  cnpj: z.string().min(14).max(20), responsibleName: z.string().trim().min(2).max(120), email: z.string().email(), phone: z.string().min(10).max(25),
  password: z.string().min(10).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/), postalCode: z.string().min(8).max(10), address: z.string().trim().min(2).max(180),
  addressNumber: z.string().trim().min(1).max(30), complement: z.string().trim().max(100).optional().default(''), district: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100), state: z.string().trim().length(2), paymentMethod: z.enum(['boleto', 'card']), acceptTerms: z.literal(true),
  acceptContract: z.literal(true), minimumTermConsent: z.literal(true), billingConsent: z.literal(true), emailCode: z.string().trim().optional()
});

const EMAIL_CODE_MINUTES = 30;
const emailCodeError = { error: 'Código de confirmação do e-mail inválido ou expirado. Peça um novo código.', code: 'EMAIL_CODE_INVALID' };

/**
 * Primeiro passo do teste grátis: o captcha barra robôs e o código prova que o e-mail de acesso é
 * de quem está se cadastrando. O ambiente só é criado em /public/trials com o código correto.
 */
publicSiteRoutes.post('/public/trials/email-code', async (req, res) => {
  const parsed = z.object({ email: z.string().trim().email().max(254), captchaToken: z.string().max(2048).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informe um e-mail válido' });
  const captcha = await verifyCaptcha(parsed.data.captchaToken, req.ip);
  if (captcha === 'unavailable') return res.status(503).json({ error: 'A verificação anti-robô está indisponível. Tente novamente em instantes.', code: 'CAPTCHA_UNAVAILABLE' });
  if (captcha === 'invalid') return res.status(400).json({ error: 'Confirme a verificação anti-robô e tente novamente.', code: 'CAPTCHA_INVALID' });
  const email = parsed.data.email.toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE lower(email)=? LIMIT 1').get(email)) return res.status(409).json({ error: 'Este e-mail já tem acesso ao Fidelizei. Entre pelo login ou recupere a senha.' });
  const recentForEmail = Number((db.prepare("SELECT COUNT(*) total FROM trial_email_codes WHERE email=? AND created_at>=datetime('now','-15 minutes')").get(email) as { total: number }).total);
  const recentForIp = req.ip ? Number((db.prepare("SELECT COUNT(*) total FROM trial_email_codes WHERE ip_address=? AND created_at>=datetime('now','-1 hour')").get(req.ip) as { total: number }).total) : 0;
  if (recentForEmail >= 3 || recentForIp >= 10) {
    res.setHeader('Retry-After', '900');
    return res.status(429).json({ error: 'Muitos códigos pedidos. Aguarde 15 minutos e confira também a caixa de spam.' });
  }
  const code = String(randomInt(100000, 1000000));
  db.transaction(() => {
    db.prepare('UPDATE trial_email_codes SET used_at=CURRENT_TIMESTAMP WHERE email=? AND used_at IS NULL').run(email);
    db.prepare(`INSERT INTO trial_email_codes(id,email,code_hash,expires_at,ip_address) VALUES(?,?,?,datetime('now','+${EMAIL_CODE_MINUTES} minutes'),?)`).run(randomUUID(), email, hashToken(code), req.ip || null);
    db.prepare("INSERT INTO outbound_messages(id,tenant_id,recipient,channel,template,subject,message,scheduled_at) VALUES(?,NULL,?,'email','trial.email_code',?,?,CURRENT_TIMESTAMP)").run(
      randomUUID(), email, 'Confirme seu e-mail · Fidelizei', `Seu código para confirmar o e-mail do teste grátis do Fidelizei é ${code}. Ele vale por ${EMAIL_CODE_MINUTES} minutos.\n\nSe você não pediu este cadastro, ignore esta mensagem.`);
  })();
  res.status(202).json({ destination: maskEmail(email), expiresInMinutes: EMAIL_CODE_MINUTES, ...(!config.isProduction ? { developmentCode: code } : {}) });
});

publicSiteRoutes.post('/public/trials', async (req, res) => {
  const parsed = trialSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Revise o cadastro e confirme o contrato, a fidelidade mínima e a cobrança após o teste' });
  const input = parsed.data, plan = planByCode(input.planCode);
  if (!plan) return res.status(409).json({ error: 'Este plano não está mais disponível. Atualize a página e escolha outro.' });
  if (input.paymentMethod === 'card' && (!asaasStatus().configured || !asaasStatus().billingEnabled)) return res.status(503).json({ error: 'O pagamento por cartão está temporariamente indisponível. Tente novamente em instantes.' });
  // Freio contra abuso do cadastro público: um teste por CNPJ e poucos testes por IP ao dia.
  if (db.prepare('SELECT 1 FROM public_trial_signups WHERE cnpj=? LIMIT 1').get(digits(input.cnpj))) return res.status(409).json({ error: 'Este CNPJ já utilizou o teste grátis. Fale com contato@fidelizaplus.com.br para contratar.' });
  if (req.ip && Number((db.prepare("SELECT COUNT(*) total FROM subscription_contract_acceptances WHERE ip_address=? AND accepted_at>=datetime('now','-1 day')").get(req.ip) as { total: number }).total) >= 3) return res.status(429).json({ error: 'Muitos cadastros a partir desta rede hoje. Tente novamente amanhã ou fale com contato@fidelizaplus.com.br.' });
  if (!input.emailCode) return res.status(400).json({ error: 'Confirme o e-mail de acesso com o código enviado antes de ativar o teste.', code: 'EMAIL_CODE_REQUIRED' });
  const emailCode = db.prepare("SELECT id,code_hash FROM trial_email_codes WHERE email=? AND used_at IS NULL AND expires_at>datetime('now') AND attempts<5 ORDER BY created_at DESC LIMIT 1").get(input.email.toLowerCase()) as { id: string; code_hash: string } | undefined;
  if (!emailCode || !/^\d{6}$/.test(input.emailCode) || !secureStringEqual(emailCode.code_hash, hashToken(input.emailCode))) {
    if (emailCode) db.prepare('UPDATE trial_email_codes SET attempts=attempts+1 WHERE id=?').run(emailCode.id);
    return res.status(400).json(emailCodeError);
  }
  const tenantId = randomUUID(), subscriptionId = randomUUID(), returnToken = randomBytes(32).toString('hex');
  try {
    const result = db.transaction(() => {
      const cleanCnpj = digits(input.cnpj), cleanPhone = digits(input.phone), cleanCep = digits(input.postalCode), email = input.email.toLowerCase();
      if (cleanCnpj.length !== 14 || cleanPhone.length < 10 || cleanCep.length !== 8) throw new Error('DATA');
      if (!db.prepare('UPDATE trial_email_codes SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL').run(emailCode.id).changes) throw new Error('EMAIL_CODE');
      const base = input.companyName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'empresa';
      const slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
      db.prepare(`INSERT INTO tenants(id,name,slug,legal_name,cnpj,email,phone,responsible_name,segment,customer_portal_enabled,address,address_number,address_complement,district,city,state,postal_code)
        VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)`).run(tenantId, input.companyName, slug, input.legalName, cleanCnpj, email, cleanPhone, input.responsibleName, '', input.address,
        input.addressNumber, input.complement || null, input.district, input.city, input.state.toUpperCase(), cleanCep);
      db.prepare(`INSERT INTO subscriptions(id,tenant_id,plan_code,status,monthly_price_cents,current_period_start,current_period_end,joined_at,payment_method,billing_day,gateway,billing_consent_at,billing_setup_status,billing_setup_token_hash)
        VALUES(?,?,?,'trialing',?,CURRENT_TIMESTAMP,date('now','+7 days'),CURRENT_TIMESTAMP,?,CAST(strftime('%d',date('now','+7 days')) AS INTEGER),'asaas',CURRENT_TIMESTAMP,'pending',?)`).run(
        subscriptionId, tenantId, plan.code, plan.monthlyPriceCents, input.paymentMethod, tokenHash(returnToken));
      db.prepare("INSERT INTO users(id,tenant_id,name,email,password_hash,role,source,phone)VALUES(?,?,?,?,?,'owner','public_trial',?)").run(randomUUID(), tenantId, input.responsibleName, email, hashPassword(input.password), cleanPhone);
      db.prepare('INSERT INTO public_trial_signups(id,tenant_id,plan_code,company_name,cnpj,email,responsible_name,phone)VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), tenantId, plan.code, input.companyName, cleanCnpj, email, input.responsibleName, cleanPhone);
      db.prepare(`INSERT INTO subscription_contract_acceptances(id,tenant_id,subscription_id,contract_version,contract_hash,contract_snapshot,signer_name,signer_email,signer_document,plan_code,monthly_price_cents,payment_method,minimum_term_consent,billing_consent,ip_address,user_agent)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?)`).run(randomUUID(),tenantId,subscriptionId,SOFTWARE_LICENSE_CONTRACT_VERSION,SOFTWARE_LICENSE_CONTRACT_HASH,SOFTWARE_LICENSE_CONTRACT_SNAPSHOT,
        input.responsibleName,email,cleanCnpj,plan.code,plan.monthlyPriceCents,input.paymentMethod,req.ip||null,String(req.headers['user-agent']||'').slice(0,500)||null);
      const end = new Date(Date.now() + 7 * 86_400_000), date = end.toLocaleDateString('pt-BR'), amount = (plan.monthlyPriceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const paymentCopy = input.paymentMethod === 'boleto' ? `Se não houver cancelamento, em ${date} será gerado o boleto no valor integral de ${amount}, enviado para este e-mail.`
        : `Conclua o cadastro seguro do cartão no Asaas. Nada será debitado agora; a primeira cobrança integral de ${amount} será feita em ${date}.`;
      db.prepare(`INSERT INTO outbound_messages(id,tenant_id,recipient,channel,template,subject,message,scheduled_at) VALUES(?,?,?,'email','trial.welcome',?,?,CURRENT_TIMESTAMP)`).run(
        randomUUID(), tenantId, email, 'Seu teste grátis do Fidelizei começou', `Olá, ${input.responsibleName}. O teste de 7 dias do plano ${plan.name} está ativo. Acesse https://fidelizaplus.com.br/login com ${email}. Nenhuma cobrança será feita durante o teste. ${paymentCopy}`);
      return { tenantId, subscriptionId, slug, trialEndsAt: end.toISOString(), plan: { code: plan.code, name: plan.name, monthlyPriceCents: plan.monthlyPriceCents } };
    })();
    let checkoutUrl: string | undefined, billingWarning: string | undefined;
    try {
      if (asaasStatus().configured) {
        await ensureAsaasCustomer(tenantId);
        if (input.paymentMethod === 'card') checkoutUrl = (await createAsaasTrialCheckout(subscriptionId, returnToken)).link;
        else db.prepare("UPDATE subscriptions SET billing_setup_status='ready',billing_setup_error=NULL WHERE id=?").run(subscriptionId);
      } else {
        db.prepare("UPDATE subscriptions SET billing_setup_status='awaiting_gateway' WHERE id=?").run(subscriptionId);
        billingWarning = 'Cadastro concluído. A cobrança será provisionada automaticamente quando o gateway estiver disponível.';
      }
    } catch (error) {
      const detail = (error as Error).message;
      db.prepare("UPDATE subscriptions SET billing_setup_status='error',billing_setup_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(detail, subscriptionId);
      if (input.paymentMethod === 'card') {
        db.transaction(() => { db.prepare('DELETE FROM outbound_messages WHERE tenant_id=?').run(tenantId); db.prepare('DELETE FROM public_trial_signups WHERE tenant_id=?').run(tenantId);db.prepare('DELETE FROM subscription_contract_acceptances WHERE tenant_id=?').run(tenantId);
          db.prepare('DELETE FROM users WHERE tenant_id=?').run(tenantId); db.prepare('DELETE FROM subscriptions WHERE tenant_id=?').run(tenantId); db.prepare('DELETE FROM tenants WHERE id=?').run(tenantId);
          // O e-mail continua confirmado: a pessoa pode tentar de novo sem pedir outro código.
          db.prepare('UPDATE trial_email_codes SET used_at=NULL WHERE id=?').run(emailCode.id); })();
        return res.status(502).json({ error: 'Não foi possível abrir o cadastro seguro do cartão no Asaas. Nenhuma assinatura foi ativada; tente novamente.' });
      }
      billingWarning = 'O ambiente foi criado e o provisionamento do boleto será repetido automaticamente antes da primeira cobrança.';
    }
    res.status(201).json({ ...result, paymentMethod: input.paymentMethod, checkoutUrl, billingWarning });
  } catch (error) {
    const message = String((error as Error).message);
    if (message === 'DATA') return res.status(400).json({ error: 'CNPJ, CEP ou telefone inválido' });
    if (message === 'EMAIL_CODE') return res.status(400).json(emailCodeError);
    if (message.includes('UNIQUE')) return res.status(409).json({ error: 'CNPJ ou e-mail já cadastrado' });
    throw error;
  }
});

publicSiteRoutes.post('/public/trials/billing-confirm', (req, res) => {
  const parsed = z.object({ token: z.string().length(64), status: z.enum(['success', 'cancel', 'expired']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Retorno de pagamento inválido' });
  const subscription = db.prepare('SELECT id FROM subscriptions WHERE billing_setup_token_hash=?').get(tokenHash(parsed.data.token)) as { id: string } | undefined;
  if (!subscription) return res.status(404).json({ error: 'Assinatura não encontrada' });
  // O retorno vem do navegador e pode ser forjado: "success" só indica que a pessoa voltou do checkout.
  // O cartão fica "ready" quando o Asaas confirma pelo webhook, e esse estado não é desfeito por aqui.
  const status = parsed.data.status === 'success' ? 'checkout_returned' : parsed.data.status;
  db.prepare("UPDATE subscriptions SET billing_setup_status=?,billing_setup_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND billing_setup_status<>'ready'").run(status, subscription.id);
  res.json({ ok: true, status: (db.prepare('SELECT billing_setup_status status FROM subscriptions WHERE id=?').get(subscription.id) as { status: string }).status });
});
