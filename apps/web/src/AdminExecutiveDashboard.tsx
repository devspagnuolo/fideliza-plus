import { Activity, AlertTriangle, ArrowUpRight, Building2, CheckCircle2, Clock3, CreditCard, RefreshCw, ShieldCheck, Users, WalletCards, Zap } from 'lucide-react';

const money = (value = 0) => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const statusLabel: Record<string, string> = { active: 'Ativa', trialing: 'Em teste', suspended: 'Suspensa', past_due: 'Inadimplente', canceled: 'Cancelada' };

type Props = {
  dash: any;
  all: any;
  updatedAt: Date;
  refreshing: boolean;
  onRefresh: () => void;
  onNavigate: (page: string, subpage: string) => void;
};

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return <span className="pa-mini-bars" aria-hidden="true">{values.map((value, index) => <i key={index} style={{ height: `${Math.max(12, value / max * 100)}%` }} />)}</span>;
}

function ExecutiveCard({ icon: Icon, label, value, detail, bars, tone, onClick }: any) {
  return <button className={`pa-exec-card ${tone}`} onClick={onClick}>
    <span className="pa-exec-icon"><Icon /></span>
    <span className="pa-exec-copy"><small>{label}</small><strong>{value}</strong><em>{detail}</em></span>
    <MiniBars values={bars} /><ArrowUpRight className="pa-exec-arrow" />
  </button>;
}

export function AdminExecutiveDashboard({ dash, all, updatedAt, refreshing, onRefresh, onNavigate }: Props) {
  const business = dash.business;
  const operational = dash.operational;
  const companies = all.companies || [];
  const invoices = all.finance?.invoices || [];
  const plans = all.finance?.byPlan || [];
  const activeShare = business.tenants ? Math.round((business.active / business.tenants) * 100) : 0;
  const consumerShare = business.consumers ? Math.round((business.activeConsumers30 / business.consumers) * 100) : 0;
  const health = Math.max(0, Math.round((operational.availability || 100) - Math.min(20, operational.integrationErrors * 4) - Math.min(15, operational.failedProcesses * 2)));
  const maxPlanRevenue = Math.max(1, ...plans.map((item: any) => Number(item.revenueCents || 0)));
  const unresolvedAlerts = (dash.alerts || []).reduce((sum: number, item: any) => sum + Number(item.value || 0), 0);

  return <section className="pa-executive-dashboard">
    <section className="pa-command-hero">
      <div className="pa-command-copy">
        <span className="pa-command-kicker"><ShieldCheck /> CENTRAL DE COMANDO</span>
        <h2>Visão executiva da Fidelizei</h2>
        <p>Receita, clientes, operação e riscos em uma leitura única para tomada de decisão.</p>
        <div className="pa-command-meta"><span><CheckCircle2 /> Ambiente de produção</span><span><Clock3 /> Atualizado às {updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></div>
      </div>
      <div className="pa-command-actions">
        <button onClick={onRefresh} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} />{refreshing ? 'Atualizando' : 'Atualizar dados'}</button>
        <button className="secondary" onClick={() => onNavigate('companies', 'Nova empresa')}><Building2 /> Nova empresa</button>
      </div>
    </section>

    <div className="pa-exec-grid">
      <ExecutiveCard icon={Building2} label="Empresas" value={business.tenants} detail={`${business.active} ativas · ${business.trialing} em teste`} bars={[business.trialing, business.suspended, business.active]} tone="navy" onClick={() => onNavigate('companies', 'Listagem de empresas')} />
      <ExecutiveCard icon={Users} label="Usuários e consumidores" value={business.consumers.toLocaleString('pt-BR')} detail={`${business.activeConsumers30} ativos nos últimos 30 dias`} bars={[business.activeConsumers30, Math.max(0, business.consumers - business.activeConsumers30), business.consumers]} tone="blue" onClick={() => onNavigate('users', 'Todos os usuários')} />
      <ExecutiveCard icon={WalletCards} label="Receita recorrente mensal" value={money(business.mrrCents)} detail={`ARR ${money(business.arrCents)} · churn ${business.churnRate}%`} bars={plans.map((x: any) => x.revenueCents).slice(0, 6)} tone="teal" onClick={() => onNavigate('finance', 'MRR')} />
      <ExecutiveCard icon={Activity} label="Saúde da plataforma" value={`${health}%`} detail={`${operational.averageResponseMs} ms · ${operational.integrationErrors} integração(ões) em atenção`} bars={[100 - operational.failedProcesses, 100 - operational.integrationErrors, health]} tone="green" onClick={() => onNavigate('monitoring', 'Dashboard técnico')} />
    </div>

    <section className="pa-action-center" aria-label="Prioridades operacionais">
      <header><div><small>PRÓXIMOS PASSOS</small><h3>O que acompanhar agora</h3><p>Indicadores atuais com acesso direto à área responsável.</p></div></header>
      <div className="pa-action-grid">
        <article className={invoices.some((item:any)=>item.status==='overdue')?'attention':''}><span>Financeiro</span><strong>{invoices.filter((item:any)=>item.status==='overdue').length} fatura(s) vencida(s)</strong><p>{invoices.some((item:any)=>item.status==='overdue')?'Revisar a régua de cobrança e conciliação.':'Nenhuma fatura vencida nesta leitura.'}</p><button onClick={()=>onNavigate('finance','Inadimplência')}>Abrir inadimplência <ArrowUpRight/></button></article>
        <article className={operational.failedProcesses?'attention':''}><span>Operação</span><strong>{operational.failedProcesses || 0} processamento(s) com falha</strong><p>{operational.failedProcesses?'Priorizar a análise das falhas antes de reprocessar.':'Processamentos sem falha registrada.'}</p><button onClick={()=>onNavigate('operations','Processamentos')}>Abrir processamentos <ArrowUpRight/></button></article>
        <article><span>Carteira</span><strong>{business.trialing || 0} empresa(s) em teste</strong><p>{activeShare}% da carteira está ativa; acompanhe conversões e adesão.</p><button onClick={()=>onNavigate('analytics','Conversão Trial')}>Ver conversão <ArrowUpRight/></button></article>
      </div>
    </section>

    <div className="pa-exec-layout">
      <section className="pa-insight-card pa-revenue-panel">
        <header><div><small>DESEMPENHO COMERCIAL</small><h3>Receita por plano</h3><p>Composição do MRR atual por oferta.</p></div><button onClick={() => onNavigate('finance', 'Receita')}>Abrir financeiro <ArrowUpRight /></button></header>
        <div className="pa-plan-performance">
          {plans.length ? plans.map((item: any) => <div key={item.plan} className="pa-plan-line"><div><span>{item.plan}</span><b>{money(item.revenueCents)}</b></div><div className="pa-progress"><i style={{ width: `${Math.max(2, item.revenueCents / maxPlanRevenue * 100)}%` }} /></div><small>{item.subscriptions} assinatura(s)</small></div>) : <div className="pa-empty">A receita aparecerá após a ativação das primeiras assinaturas pagas.</div>}
        </div>
        <footer><span><CreditCard /> {invoices.filter((x: any) => x.status === 'pending').length} fatura(s) a receber</span><b>{money(all.finance?.summary?.pendingCents || 0)}</b></footer>
      </section>

      <section className="pa-insight-card pa-health-panel">
        <header><div><small>OPERAÇÃO EM TEMPO REAL</small><h3>Índice de saúde</h3></div><Zap /></header>
        <div className="pa-health-score"><div style={{ '--score': `${health * 3.6}deg` } as any}><span><b>{health}</b><small>/100</small></span></div><p>{health >= 95 ? 'Plataforma saudável e pronta para escalar.' : 'Existem pontos de atenção operacional.'}</p></div>
        <div className="pa-health-list">
          <button onClick={() => onNavigate('monitoring', 'APIs')}><span><i className="ok" />Disponibilidade</span><b>{operational.availability}%</b></button>
          <button onClick={() => onNavigate('operations', 'Filas')}><span><i className={operational.pendingProcesses ? 'warn' : 'ok'} />Fila operacional</span><b>{operational.pendingProcesses} pendente(s)</b></button>
          <button onClick={() => onNavigate('integrations', 'ERP')}><span><i className={operational.integrationErrors ? 'danger' : 'ok'} />Integrações</span><b>{operational.integrationErrors ? `${operational.integrationErrors} alerta(s)` : 'Normal'}</b></button>
        </div>
      </section>
    </div>

    <div className="pa-exec-layout bottom">
      <section className="pa-insight-card pa-portfolio-panel">
        <header><div><small>CARTEIRA SAAS</small><h3>Empresas recentes</h3></div><button onClick={() => onNavigate('companies', 'Listagem de empresas')}>Ver todas <ArrowUpRight /></button></header>
        <div className="pa-portfolio-table">
          <div className="head"><span>Empresa</span><span>Plano</span><span>Base</span><span>Status</span></div>
          {companies.slice(0, 5).map((company: any) => <button key={company.id} onClick={() => onNavigate('companies', 'Listagem de empresas')}><span><b>{company.name}</b><small>{company.responsibleName || company.email || 'Responsável não informado'}</small></span><span>{company.planCode || '—'}</span><span>{company.customers.toLocaleString('pt-BR')}</span><span><i className={`badge ${company.status}`}>{statusLabel[company.status] || company.status}</i></span></button>)}
        </div>
        <footer><span>{activeShare}% da carteira está ativa</span><span>{consumerShare}% dos consumidores ativos em 30 dias</span></footer>
      </section>

      <section className="pa-insight-card pa-alert-center">
        <header><div><small>PRIORIDADES</small><h3>Central de alertas</h3></div><span className={unresolvedAlerts ? 'attention' : 'clear'}>{unresolvedAlerts ? `${unresolvedAlerts} ocorrência(s)` : 'Tudo certo'}</span></header>
        <div>{(dash.alerts || []).map((alert: any) => <button key={alert.label} onClick={() => onNavigate(alert.label.includes('Integra') ? 'integrations' : alert.label.includes('Incidente') ? 'monitoring' : 'finance', alert.label.includes('Integra') ? 'ERP' : alert.label.includes('Incidente') ? 'Incidentes' : 'Inadimplência')}><span className={`pa-alert-icon ${alert.type}`}>{alert.value ? <AlertTriangle /> : <CheckCircle2 />}</span><span><b>{alert.label}</b><small>{alert.value ? 'Requer acompanhamento' : 'Nenhuma ocorrência'}</small></span><strong>{alert.value}</strong></button>)}</div>
      </section>
    </div>
  </section>;
}
