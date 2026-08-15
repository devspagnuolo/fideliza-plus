import type{ReactNode}from'react';import{API_URL}from'./api';

const money=(v=0)=>(v/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v?:string)=>v?new Date(v).toLocaleDateString('pt-BR'):'—';
const label=(v:string)=>({active:'Ativa',trialing:'Em teste',suspended:'Suspensa',past_due:'Inadimplente',paid:'Pago',pending:'Pendente',overdue:'Vencido',completed:'Concluído',failed:'Falhou'}as Record<string,string>)[v]||v;
function Empty({children}:{children:string}){return <div className="pa-empty">{children}</div>}
function Hero({area,title,children}:{area:string,title:string,children:string}){return <div className="pa-module-hero"><div><small>{area}</small><h2>{title}</h2><p>{children}</p></div><span>Módulo ativo</span></div>}
function Stats({items}:{items:Array<[string,string|number]>}){return <div className="pa-kpis module">{items.map(([k,v])=><article className="pa-kpi" key={k}><span>{k}</span><b>{v}</b></article>)}</div>}
function Rows({items,empty='Nenhum registro encontrado.'}:{items:Array<[string,string|number,string?]>,empty?:string}){return <div className="pa-card pa-purpose-list">{items.length?items.map(([a,b,c],i)=><div className="pa-row" key={a+i}><span><b>{a}</b>{c&&<small>{c}</small>}</span><strong>{b}</strong></div>):<Empty>{empty}</Empty>}</div>}
function Matrix({heads,rows}:{heads:string[],rows:Array<Array<string|number>>}){return <div className="pa-table"><div className="pa-purpose-tr pa-th">{heads.map(x=><span key={x}>{x}</span>)}</div>{rows.length?rows.map((r,i)=><div className="pa-purpose-tr" key={i}>{r.map((x,j)=><span key={j}>{x}</span>)}</div>):<Empty>Nenhum registro encontrado.</Empty>}</div>}
function SettingsForm({fields}:{fields:string[]}){return <form className="pa-card pa-purpose-form"><div className="pa-form-grid">{fields.map(x=><label key={x}>{x}<input placeholder={`Informe ${x.toLowerCase()}`}/></label>)}</div><button type="button">Salvar configurações</button></form>}

export function PurposeAdminSubpage({page,subpage,dash,all}:{page:string,subpage:string,dash:any,all:any}){
 const companies=all.companies as any[],users=all.users as any[],invoices=all.finance.invoices as any[],integrations=all.monitoring.integrations as any[],audit=all.audit as any[],tickets=all.support as any[],incidents=all.monitoring.incidents as any[];
 let body:ReactNode;
 if(page==='dashboard'){
  if(subpage==='Indicadores')body=<><Stats items={[["Empresas ativas",dash.business.active],["Trial",dash.business.trialing],["Consumidores",dash.business.consumers],["Conversão",`${dash.business.trialConversion}%`],["Churn",`${dash.business.churnRate}%`],["Logados hoje",dash.operational.usersToday],["Processamentos",dash.operational.processes],["Erros",dash.operational.failedProcesses]]}/></>;
  else if(subpage.includes('Receita'))body=<><Stats items={[["MRR",money(dash.business.mrrCents)],["ARR",money(dash.business.arrCents)],["Receita acumulada",money(all.finance.summary.accumulatedRevenueCents)],["Inadimplência",money(all.finance.summary.overdueCents)]]}/><Rows items={all.finance.byPlan.map((x:any)=>[x.plan,money(x.revenueCents),`${x.subscriptions} assinatura(s)`])}/></>;
  else if(subpage==='Alertas')body=<Rows items={dash.alerts.map((x:any)=>[x.label,x.value,x.type==='danger'?'Ação imediata recomendada':'Acompanhamento necessário'])} empty="Nenhum alerta ativo."/>;
  else body=<><Stats items={[["Disponibilidade",`${dash.operational.availability}%`],["Resposta média",`${dash.operational.averageResponseMs} ms`],["Erros de integração",dash.operational.integrationErrors],["Uptime",`${Math.floor(dash.operational.uptimeSeconds/3600)}h`]]}/><Rows items={incidents.map(x=>[x.title,label(x.status),date(x.started_at)])} empty="Nenhum incidente em aberto."/></>;
 }else if(page==='companies'){
  if(subpage==='Nova empresa')body=<SettingsForm fields={['Razão social','Nome fantasia','CNPJ','E-mail principal','Telefone','Responsável','Plano inicial']}/>;
  else if(subpage==='Assinaturas')body=<Matrix heads={['Empresa','Plano','Status','Mensalidade','Próximo vencimento']} rows={companies.map(c=>[c.name,c.planCode||'—',label(c.status),money(c.monthlyPriceCents),date(c.currentPeriodEnd)])}/>;
  else if(subpage==='Cobranças')body=<Matrix heads={['Empresa','Valor','Status','Vencimento','Pagamento']} rows={invoices.map(x=>[x.companyName,money(x.amountCents),label(x.status),date(x.dueAt),date(x.paidAt)])}/>;
  else if(subpage==='Empresas suspensas')body=<Rows items={companies.filter(c=>c.status==='suspended'||c.loginBlocked).map(c=>[c.name,c.loginBlocked?'Login bloqueado':'Suspensa',c.responsibleName||c.email])} empty="Nenhuma empresa suspensa."/>;
  else body=<Matrix heads={['Data','Responsável','Ação','Empresa','IP']} rows={audit.filter(x=>x.entityType==='tenant').map(x=>[date(x.createdAt),x.actor||'Sistema',x.action,x.entityId||'—',x.ip||'—'])}/>;
 }else if(page==='users'){
  if(subpage==='Administradores')body=<Matrix heads={['Nome','E-mail','Empresa','Perfil','Último acesso']} rows={users.filter(u=>u.role==='owner').map(u=>[u.name,u.email,u.companyName,'Admin Empresa',date(u.lastLoginAt)])}/>;
  else if(subpage==='Perfis')body=<Rows items={[['Super Admin','Gestão integral','Administração da plataforma'],['Admin Empresa','Gestão do tenant','Configura empresa e equipe'],['Gestor','Gestão operacional','Clientes, vendas e campanhas'],['Operador','Operação diária','Cadastro e atendimento'],['Usuário final','Portal do consumidor','Saldo e recompensas']]}/>;
  else if(subpage==='Permissões')body=<Matrix heads={['Perfil','Empresas','Usuários','Financeiro','Configurações']} rows={[["Super Admin","Total","Total","Total","Total"],["Admin Empresa","Própria","Própria","Própria","Própria"],["Gestor","Leitura","Equipe","Leitura","Limitada"],["Operador","—","—","—","—"]]}/>;
  else if(subpage==='MFA')body=<Matrix heads={['Usuário','Empresa','MFA configurado','Obrigatório']} rows={users.map(u=>[u.name,u.companyName,u.twoFactorEnabled?'Sim':'Não',u.mfaRequired?'Sim':'Não'])}/>;
  else if(subpage==='Usuários bloqueados')body=<Rows items={users.filter(u=>!u.active).map(u=>[u.name,u.email,u.companyName])} empty="Nenhum usuário bloqueado."/>;
  else body=<Empty>Nenhum convite pendente. A gestão de convites será exibida aqui.</Empty>;
 }else if(page==='finance'){
  if(subpage==='MRR'||subpage==='ARR')body=<><Stats items={[[subpage,subpage==='MRR'?money(dash.business.mrrCents):money(dash.business.arrCents)],["Empresas pagantes",dash.business.active],["Ticket SaaS",dash.business.active?money(dash.business.mrrCents/dash.business.active):money(0)],["Churn",`${dash.business.churnRate}%`]]}/><Rows items={all.finance.byPlan.map((x:any)=>[x.plan,money(subpage==='ARR'?x.revenueCents*12:x.revenueCents),`${x.subscriptions} assinatura(s)`])}/></>;
  else if(subpage==='Faturas')body=<Matrix heads={['Empresa','Valor','Status','Vencimento']} rows={invoices.map(x=>[x.companyName,money(x.amountCents),label(x.status),date(x.dueAt)])}/>;
  else if(subpage==='Pagamentos')body=<Matrix heads={['Empresa','Valor','Pagamento','Status']} rows={invoices.filter(x=>x.status==='paid').map(x=>[x.companyName,money(x.amountCents),date(x.paidAt),'Conciliado'])}/>;
  else if(subpage==='Inadimplência')body=<Rows items={invoices.filter(x=>x.status==='overdue').map(x=>[x.companyName,money(x.amountCents),`Vencimento ${date(x.dueAt)}`])} empty="Nenhuma fatura inadimplente."/>;
  else if(subpage==='Cupons')body=<SettingsForm fields={['Código do cupom','Tipo de desconto','Valor','Validade','Limite de usos']}/>;
  else body=<div className="pa-report-grid">{[['companies','Empresas'],['finance','Receitas'],['users','Assinantes']].map(([id,n])=><a className="pa-card" href={`${API_URL}/platform/reports/export?report=${id}`} key={id}>Exportar relatório de {n}</a>)}</div>;
 }else if(page==='plans'){
  if(subpage==='Recursos')body=<Matrix heads={['Plano','Recursos liberados']} rows={all.plans.map((p:any)=>[p.name,p.features.join(', ')||'Recursos básicos'])}/>;
  else if(subpage==='Limites')body=<Matrix heads={['Plano','Usuários','Consumidores','Armazenamento']} rows={all.plans.map((p:any)=>[p.name,p.userLimit,p.consumerLimit,`${p.storageMb} MB`])}/>;
  else if(subpage==='Add-ons')body=<SettingsForm fields={['Nome do add-on','Preço mensal','Recurso liberado','Limite adicional']}/>;
  else if(subpage==='Trial')body=<Rows items={companies.filter(c=>c.status==='trialing').map(c=>[c.name,date(c.currentPeriodEnd),c.responsibleName||'Sem responsável'])} empty="Nenhuma empresa em trial."/>;
  else body=<SettingsForm fields={['Duração padrão do trial','Desconto máximo','Prazo de tolerância','Regra de upgrade']}/>;
 }else if(page==='analytics'){
  const metric:Record<string,Array<[string,string|number]>>={Empresas:[["Total",dash.business.tenants],["Ativas",dash.business.active],["Trial",dash.business.trialing],["Suspensas",dash.business.suspended]],Consumidores:[["Total",dash.business.consumers],["Ativos 30d",dash.business.activeConsumers30],["Ativação",dash.business.consumers?`${Math.round(dash.business.activeConsumers30/dash.business.consumers*100)}%`:'0%'],["Cadastros hoje",dash.operational.createdToday]],Engajamento:[["Ativos 30d",dash.business.activeConsumers30],["Logados hoje",dash.operational.usersToday],["Processamentos",dash.operational.processes],["Base total",dash.business.consumers]],Crescimento:[["MRR",money(dash.business.mrrCents)],["ARR",money(dash.business.arrCents)],["Conversão",`${dash.business.trialConversion}%`],["Churn",`${dash.business.churnRate}%`]],'Conversão Trial':[["Em trial",dash.business.trialing],["Pagantes",dash.business.active],["Conversão",`${dash.business.trialConversion}%`],["Suspensas",dash.business.suspended]],Churn:[["Taxa",`${dash.business.churnRate}%`],["Canceladas",companies.filter(c=>c.status==='canceled').length],["Suspensas",dash.business.suspended],["Ativas",dash.business.active]]};
  body=subpage==='Relatórios personalizados'?<SettingsForm fields={['Nome do relatório','Métricas','Período','Formato','Destinatários']}/>:<><Stats items={metric[subpage]||[]}/><Rows items={companies.map(c=>[c.name,c.customers,`${label(c.status)} · ${c.planCode}`])}/></>;
 }else if(page==='integrations'){
  const providers:Record<string,string[]>= {APIs:['api','public_api'],Webhooks:['webhook'],ERP:['bling','erp'],CRM:['crm'],Pagamentos:['stripe','payment'],'E-mail':['smtp','email'],SSO:['sso','saml']},wanted=providers[subpage]||[];
  body=<><Stats items={[["Conexões",integrations.filter(x=>wanted.some(p=>String(x.provider).toLowerCase().includes(p))).length],["Erros",dash.operational.integrationErrors],["Empresas",new Set(integrations.map(x=>x.companyName)).size],["Última execução",dash.operational.processes]]}/><Matrix heads={['Empresa','Provedor','Status','Última sincronização']} rows={integrations.filter(x=>!wanted.length||wanted.some(p=>String(x.provider).toLowerCase().includes(p))).map(x=>[x.companyName,x.provider,label(x.status),date(x.lastSyncAt)])}/></>;
 }else if(page==='operations'){
  if(subpage==='Filas'||subpage==='Jobs'||subpage==='Processamentos')body=<><Stats items={[["Executados",dash.operational.processes],["Pendentes",dash.operational.pendingProcesses],["Falhas",dash.operational.failedProcesses],["Status",dash.operational.failedProcesses?'Atenção':'Normal']]}/><Rows items={all.monitoring.queues.map((x:any)=>[label(x.status),x.count,subpage])} empty="Nenhum processamento registrado."/></>;
  else if(subpage==='Importações')body=<Rows items={integrations.map(x=>[x.companyName,label(x.status),`${x.provider} · ${date(x.lastSyncAt)}`])} empty="Nenhuma importação recente."/>;
  else if(subpage==='Exportações')body=<div className="pa-report-grid">{['companies','users','finance'].map(id=><a className="pa-card" href={`${API_URL}/platform/reports/export?report=${id}`} key={id}>Gerar exportação: {id}</a>)}</div>;
  else body=<SettingsForm fields={['Nome da rotina','Frequência','Horário','Empresa','Processamento']}/>;
 }else if(page==='monitoring'){
  if(subpage==='APIs'||subpage==='Performance'||subpage==='Dashboard técnico')body=<Stats items={[["Requisições",all.monitoring.runtime.requests],["Erros",all.monitoring.runtime.errors],["Resposta média",`${all.monitoring.runtime.averageResponseMs} ms`],["Disponibilidade",`${dash.operational.availability}%`]]}/>;
  else if(subpage==='Banco de dados')body=<Rows items={[["Banco principal","Operacional","Persistência ativa"],["Backup","Habilitado","Rotina automática"],["Disco","Monitorado","Render persistent disk"]]}/>;
  else if(subpage==='Logs')body=<Matrix heads={['Data','Responsável','Evento','Entidade','IP']} rows={audit.map(x=>[date(x.createdAt),x.actor||'Sistema',x.action,x.entityType,x.ip||'—'])}/>;
  else body=<Rows items={incidents.map(x=>[x.title,label(x.status),date(x.started_at)])} empty="Nenhum incidente registrado."/>;
 }else if(page==='security'){
  if(subpage.includes('Auditoria')||subpage.includes('Log de'))body=<Matrix heads={['Data','Responsável','Ação','Entidade','IP']} rows={audit.map(x=>[date(x.createdAt),x.actor||'Sistema',x.action,x.entityType,x.ip||'—'])}/>;
  else if(subpage==='MFA')body=<Matrix heads={['Usuário','Empresa','Configurado','Obrigatório']} rows={users.map(u=>[u.name,u.companyName,u.twoFactorEnabled?'Sim':'Não',u.mfaRequired?'Sim':'Não'])}/>;
  else if(subpage==='Controle de permissões')body=<Matrix heads={['Perfil','Escopo','Nível']} rows={[["Super Admin","Plataforma","Total"],["Admin Empresa","Tenant","Administrativo"],["Gestor","Tenant","Gestão"],["Operador","Tenant","Operacional"]]}/>;
  else body=<SettingsForm fields={subpage==='LGPD'?['Encarregado de dados','E-mail de privacidade','Prazo de retenção','Canal do titular']:subpage==='Política de senhas'?['Tamanho mínimo','Expiração em dias','Tentativas máximas','Tempo de bloqueio']:['Duração máxima','Encerrar sessões inativas','Alerta de novo dispositivo']}/>;
 }else if(page==='support'){
  if(subpage==='Chamados')body=<Matrix heads={['Empresa','Assunto','Prioridade','Status','SLA']} rows={tickets.map(x=>[x.companyName||'Plataforma',x.subject,x.priority,label(x.status),date(x.slaDueAt)])}/>;
  else if(subpage==='SLA')body=<Stats items={[["Chamados",tickets.length],["Abertos",tickets.filter(x=>x.status!=='closed').length],["Urgentes",tickets.filter(x=>x.priority==='urgent').length],["Vencidos",tickets.filter(x=>x.slaDueAt&&new Date(x.slaDueAt)<new Date()).length]]}/>;
  else if(subpage==='Feedbacks')body=<Empty>Nenhum feedback recebido.</Empty>;
  else if(subpage==='Base de conhecimento')body=<SettingsForm fields={['Título do artigo','Categoria','Resumo','Conteúdo']}/>;
  else body=<SettingsForm fields={['Canal','Evento','Destinatários','Modelo da mensagem']}/>;
 }else{
  const fields:Record<string,string[]>={'Branding':['Nome da plataforma','Cor principal','Logotipo','Favicon'],'SMTP':['Servidor SMTP','Porta','Usuário','Remetente'],'Notificações':['E-mail administrativo','Alertas críticos','Resumo diário'],'Domínios':['Domínio principal','Subdomínio da API','Redirecionamento www'],'Variáveis do sistema':['Ambiente','Fuso horário','Idioma','Moeda'],'Feature flags':['Funcionalidade','Público','Percentual de liberação'],'Backup e retenção':['Frequência','Retenção em dias','Diretório','Teste de restauração']};
  body=<SettingsForm fields={fields[subpage]||['Nome da plataforma','Domínio oficial','Idioma','Fuso horário']}/>;
 }
 return <section className="pa-module-page"><Hero area={page} title={subpage}>Visão e controles específicos para esta finalidade administrativa.</Hero>{body}</section>;
}
