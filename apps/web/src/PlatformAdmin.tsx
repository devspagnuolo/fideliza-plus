import { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, Building2, ChevronDown, CreditCard, Headphones, KeyRound, LayoutDashboard, LockKeyhole, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plug, RefreshCw, Search, Settings, Users, WalletCards, Wrench, X } from 'lucide-react';
import { api,ApiError } from './api';
import { PurposeAdminSubpage } from './AdminSubpages';
import { CompaniesWorkspace, UsersWorkspace } from './AdminCoreWorkspaces';
import { AdvancedWorkspace } from './AdminWorkspaceRouter';
import { AdminDashboardWorkspace } from './AdminDashboardWorkspace';
import { BrandLogo } from './BrandLogo';
import { LegalFooter } from './LegalPages';
import './platform-admin.css';
import './contrast-fixes.css';
import './visual-quality.css';

const menu = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, children: ['Visão geral', 'Indicadores', 'Receita (MRR/ARR)', 'Alertas', 'Saúde da plataforma'] },
  { id: 'companies', label: 'Empresas', icon: Building2, children: ['Listagem de empresas', 'Nova empresa', 'Assinaturas', 'Cobranças', 'Empresas suspensas', 'Histórico de alterações'] },
  { id: 'users', label: 'Usuários', icon: Users, children: ['Todos os usuários', 'Administradores', 'Perfis', 'Permissões', 'MFA', 'Usuários bloqueados', 'Convites pendentes'] },
  { id: 'finance', label: 'Financeiro', icon: WalletCards, children: ['Receita', 'MRR', 'ARR', 'Faturas', 'Pagamentos', 'Inadimplência', 'Cupons', 'Relatórios financeiros'] },
  { id: 'plans', label: 'Planos', icon: CreditCard, children: ['Planos e licenciamento', 'Recursos', 'Limites', 'Add-ons', 'Trial', 'Regras comerciais'] },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, children: ['Empresas', 'Consumidores', 'Engajamento', 'Crescimento', 'Conversão Trial', 'Churn', 'Relatórios personalizados'] },
  { id: 'integrations', label: 'Integrações', icon: Plug, children: ['APIs', 'Webhooks', 'ERP', 'CRM', 'Pagamentos', 'E-mail', 'SSO'] },
  { id: 'operations', label: 'Operações', icon: Wrench, children: ['Jobs', 'Filas', 'Processamentos', 'Importações', 'Exportações', 'Agendamentos'] },
  { id: 'monitoring', label: 'Monitoramento', icon: Activity, children: ['Status dos serviços', 'APIs', 'Banco de dados', 'Performance', 'Logs', 'Incidentes', 'Dashboard técnico'] },
  { id: 'security', label: 'Segurança', icon: LockKeyhole, children: ['Central SOC', 'Auditoria', 'Log de acessos', 'Log de alterações', 'LGPD', 'MFA', 'Sessões ativas', 'Política de senhas', 'Controle de permissões'] },
  { id: 'support', label: 'Suporte', icon: Headphones, children: ['Chamados', 'SLA', 'Feedbacks', 'Base de conhecimento', 'Notificações'] },
  { id: 'settings', label: 'Configurações', icon: Settings, children: ['Configurações gerais', 'Branding', 'SMTP', 'Notificações', 'Domínios', 'Variáveis do sistema', 'Feature flags', 'Backup e retenção'] }
] as const;

const pageDescription: Record<string, string> = {
  dashboard: 'Indicadores estratégicos, receita, riscos e saúde operacional em uma única visão.',
  companies: 'Ciclo completo das empresas, assinaturas, cobrança e governança da carteira SaaS.',
  users: 'Identidades, acessos, perfis e permissões de toda a plataforma.',
  finance: 'Receita recorrente, contas a receber, pagamentos e inadimplência.',
  plans: 'Ofertas, limites, recursos, trial e regras comerciais.',
  analytics: 'Crescimento, conversão, engajamento e retenção da plataforma.',
  integrations: 'Conectores, APIs, webhooks e comunicação com serviços externos.',
  operations: 'Filas, processamentos, importações e rotinas automatizadas.',
  monitoring: 'Disponibilidade, performance, incidentes e telemetria em tempo real.',
  security: 'Auditoria, acesso, LGPD e políticas corporativas de proteção.',
  support: 'Chamados, SLAs, conhecimento e relacionamento com as empresas.',
  settings: 'Parâmetros globais, marca, domínios, comunicação e continuidade.'
};

export function PlatformAdmin() {
  const [admin, setAdmin] = useState<any>();
  const [dash, setDash] = useState<any>();
  const [all, setAll] = useState<any>();
  const [page, setPage] = useState('dashboard');
  const [subpage, setSubpage] = useState('Visão geral');
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [mobile, setMobile] = useState(false);
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ dashboard: true });
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('fideliza_admin_sidebar') === 'collapsed');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(new Date());
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [requiresTotp, setRequiresTotp] = useState(false);

  const load = async () => {
    setRefreshing(true); setLoadError('');
    try {
      const [dashboard, overview] = await Promise.all([api('/platform/dashboard'), api('/platform/overview')]);
      setDash(dashboard); setAll(overview); setUpdatedAt(new Date());
    } catch {
      setLoadError('Não foi possível atualizar os indicadores. Confira a conexão e tente novamente.');
    } finally { setRefreshing(false); }
  };
  const check = () => api('/platform/me').then(value => { setAuthError(''); setAdmin(value); return value; }).catch(reason => {
    if (reason instanceof ApiError && reason.status === 401) { setAuthError(''); setAdmin(null); }
    else { setAuthError('Não foi possível validar seu acesso administrativo. Confira a conexão e tente novamente.'); setAdmin(undefined); }
    return undefined;
  });
  useEffect(() => { check().catch(() => setAdmin(null)); }, []);
  useEffect(() => { if (admin) void load(); }, [admin]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(value => !value); } if (event.key === 'Escape') setSearchOpen(false); };
    addEventListener('keydown', handler); return () => removeEventListener('keydown', handler);
  }, []);

  const navigate = (nextPage: string, nextSubpage: string) => {
    setPage(nextPage); setSubpage(nextSubpage); setExpanded(value => ({ ...value, [nextPage]: true })); setMobile(false); setSearchOpen(false); scrollTo({ top: 0, behavior: 'smooth' });
  };
  const toggleMenuGroup = (nextPage: string, firstSubpage: string) => {
    setExpanded(value => ({ ...value, [nextPage]: !value[nextPage] }));
    if (page !== nextPage) {
      setPage(nextPage);
      setSubpage(firstSubpage);
      setSearchOpen(false);
      scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  const searchResults = useMemo(() => menu.flatMap(item => item.children.map(child => ({ page: item.id, parent: item.label, child }))).filter(item => `${item.parent} ${item.child}`.toLowerCase().includes(search.toLowerCase())).slice(0, 12), [search]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try { await api('/platform/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await check(); }
    catch (reason) { const message=(reason as Error).message; if(message.includes('Código do autenticador'))setRequiresTotp(true); setError(message); }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPasswordError('');
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    if (values.newPassword !== values.confirmPassword) return setPasswordError('A confirmação da nova senha não confere.');
    try {
      await api('/platform/me/password', { method: 'PUT', body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }) });
      setPasswordOpen(false); setNotice('Senha administrativa alterada. As demais sessões foram encerradas.');
    } catch (reason) { setPasswordError((reason as Error).message); }
  }

  if (admin === undefined) return <main className="pa-loading"><BrandLogo full />{authError?<section className="pa-load-state" role="alert"><b>Conexão indisponível</b><span>{authError}</span><button onClick={()=>void check()}>Tentar novamente</button></section>:<span>Validando acesso administrativo...</span>}</main>;
  if (!admin) return <main className="admin-login"><section><BrandLogo full /><small>ADMINISTRAÇÃO DA PLATAFORMA</small><h1>Central Fidelizei</h1><p>Gestão segura de empresas, receita e operação SaaS.</p><form onSubmit={login}><label>E-mail<input name="email" type="email" autoComplete="username" required /></label><label>Senha<input name="password" type="password" autoComplete="current-password" minLength={10} maxLength={128} required /></label>{requiresTotp&&<label>Código do autenticador<input name="totpCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" required/></label>}{error && <div className="error">{error}</div>}<button>Entrar no painel</button></form><a href="/acesso">Voltar para a seleção de acesso</a><LegalFooter compact /></section></main>;
  if (!dash || !all) return <main className="pa-loading"><BrandLogo full />{loadError?<section className="pa-load-state" role="alert"><b>Não foi possível carregar o painel</b><span>{loadError}</span><button disabled={refreshing} onClick={()=>void load()}>{refreshing?'Atualizando…':'Tentar novamente'}</button></section>:<span>Preparando a central de comando...</span>}</main>;

  const current = menu.find(item => item.id === page)!;
  const core = ['companies', 'users'].includes(page);
  const advanced = ['finance', 'plans', 'analytics', 'integrations', 'operations', 'monitoring', 'security', 'support', 'settings'].includes(page);
  const executive = page === 'dashboard';

  return <main className={`pa-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className={mobile ? 'open' : ''}>
      <div className="pa-logo"><BrandLogo compact={collapsed} inverse context="Administração SaaS" /><button className="pa-collapse" title={collapsed ? 'Expandir menu' : 'Recolher menu'} onClick={() => { const next = !collapsed; setCollapsed(next); localStorage.setItem('fideliza_admin_sidebar', next ? 'collapsed' : 'expanded'); }}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button><button className="pa-mobile-close" onClick={() => setMobile(false)} aria-label="Fechar menu"><X /></button></div>
      <button className="pa-nav-search" onClick={() => setSearchOpen(true)}><Search /><span>Localizar módulo</span><kbd>Ctrl K</kbd></button>
      <nav aria-label="Módulos administrativos">{menu.map(item => { const Icon = item.icon, open = !!expanded[item.id], groupId = `admin-menu-${item.id}`; return <div className="pa-nav-group" key={item.id}><button type="button" className={page === item.id ? 'active' : ''} title={item.label} aria-expanded={open} aria-controls={groupId} onClick={() => toggleMenuGroup(item.id, item.children[0])}><Icon /><span>{item.label}</span><ChevronDown className={open ? 'rotated' : ''} /></button>{open && <div className="pa-subnav" id={groupId}>{item.children.map(child => <button type="button" className={page === item.id && subpage === child ? 'selected' : ''} onClick={() => navigate(item.id, child)} key={child}>{child}</button>)}</div>}</div>; })}</nav>
      <div className="pa-user"><span>{String(admin.name || 'A')[0]}</span><div><b>{admin.name}</b><small>{admin.role === 'super_admin' ? 'Super Admin' : admin.role}</small></div><button title="Alterar senha" onClick={() => { setPasswordError(''); setPasswordOpen(true); }}><KeyRound /></button><button title="Sair" onClick={async () => { await api('/platform/auth/logout', { method: 'POST' }); location.reload(); }}><LogOut /></button></div>
    </aside>
    {mobile && <button aria-label="Fechar menu" className="pa-backdrop" onClick={() => setMobile(false)} />}

    <section className="pa-content">
      <header className="pa-topbar"><button className="pa-menu" onClick={() => setMobile(true)} aria-label="Abrir menu"><Menu /></button><div className="pa-breadcrumb"><small>ADMINISTRAÇÃO / {current.label.toUpperCase()} / {subpage.toUpperCase()}</small><h1>{subpage}</h1><p>{pageDescription[page]}</p></div><div className="pa-topbar-actions"><button className="pa-global-search" onClick={() => setSearchOpen(true)}><Search /><span>Buscar</span><kbd>Ctrl K</kbd></button><button className="pa-refresh" onClick={() => void load()} disabled={refreshing} title="Atualizar dados"><RefreshCw className={refreshing ? 'spin' : ''} /></button><span className="pa-live"><i /> Produção operacional</span></div></header>
      {notice && <div className="pa-notice" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div>}
      {loadError && <div className="pa-load-warning" role="status"><span>{loadError} Os dados exibidos podem estar desatualizados.</span><button disabled={refreshing} onClick={()=>void load()}>{refreshing?'Atualizando…':'Atualizar agora'}</button></div>}
      {executive && <AdminDashboardWorkspace subpage={subpage} dash={dash} all={all} updatedAt={updatedAt} refreshing={refreshing} onRefresh={() => void load()} onNavigate={navigate} />}
      {core && page === 'companies' && <CompaniesWorkspace subpage={subpage} all={all} refresh={load} />}
      {core && page === 'users' && <UsersWorkspace subpage={subpage} all={all} refresh={load} />}
      {advanced && <AdvancedWorkspace page={page} subpage={subpage} all={all} />}
      {!executive && !core && !advanced && <PurposeAdminSubpage page={page} subpage={subpage} dash={dash} all={all} />}
    </section>

    {searchOpen && <><button className="pa-search-backdrop" onClick={() => setSearchOpen(false)} aria-label="Fechar busca" /><section className="pa-command-search" role="dialog" aria-modal="true" aria-label="Localizar módulo"><header><Search /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Digite uma página, indicador ou configuração..." /><kbd>ESC</kbd></header><div>{searchResults.map(result => <button key={`${result.page}-${result.child}`} onClick={() => navigate(result.page, result.child)}><span><b>{result.child}</b><small>{result.parent}</small></span><ArrowResult /></button>)}</div><footer>Use a busca para navegar rapidamente por toda a administração.</footer></section></>}
    {passwordOpen && <><button className="pa-password-backdrop" onClick={() => setPasswordOpen(false)} aria-label="Fechar alteração de senha"/><section className="pa-password-modal" role="dialog" aria-modal="true" aria-label="Alterar senha administrativa"><header><div><small>SEGURANÇA DA CONTA</small><h2>Alterar senha</h2></div><button type="button" onClick={() => setPasswordOpen(false)} aria-label="Fechar"><X/></button></header><form onSubmit={changePassword}><label>Senha atual<input name="currentPassword" type="password" autoComplete="current-password" minLength={10} required/></label><label>Nova senha<input name="newPassword" type="password" autoComplete="new-password" minLength={12} required/><small>Use maiúscula, minúscula, número e símbolo.</small></label><label>Confirmar nova senha<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required/></label>{passwordError&&<div className="error">{passwordError}</div>}<button>Salvar nova senha</button></form></section></>}
  </main>;
}

function ArrowResult() { return <span aria-hidden="true">↗</span>; }
