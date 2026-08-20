import { useEffect, useMemo, useState } from 'react';
import { Activity, KeyRound, Plug, RefreshCw, Search, ShieldCheck, Workflow } from 'lucide-react';
import { api } from './api';

const date = (value?: string) => value ? new Date(value).toLocaleString('pt-BR') : '—';
const labels: Record<string, string> = { queued:'Na fila',processing:'Processando',completed:'Concluído',failed:'Falhou',connected:'Conectado',ready:'Pronto',error:'Com erro' };
export const isSystemWorkspace = (page: string) => ['integrations','operations','security'].includes(page);

export function AdminSystemWorkspace({ page, subpage }: { page: string; subpage: string }) {
  const [data,setData]=useState<any>(),[query,setQuery]=useState(''),[notice,setNotice]=useState('');
  const load=()=>api('/platform/system').then(setData);
  useEffect(()=>{void load()},[]);
  const source=useMemo(()=>{
    if(!data)return[];
    if(page==='integrations')return subpage==='Webhooks'?data.webhooks:data.connectors.filter((x:any)=>subpage==='ERP'?x.kind==='erp':subpage==='APIs'?true:x.provider.toLowerCase().includes(subpage.toLowerCase().replace('e-mail','email')));
    if(page==='operations')return data.jobs;
    if(subpage==='Sessões ativas')return data.sessions;
    if(subpage==='Log de acessos')return data.loginAttempts;
    return [];
  },[data,page,subpage]);
  const rows=source.filter((x:any)=>JSON.stringify(x).toLowerCase().includes(query.toLowerCase()));
  if(!data)return <div className="pa-notice">Carregando operação da plataforma...</div>;
  if(page==='security'&&!['Sessões ativas','Log de acessos'].includes(subpage))return <SecurityPolicy subpage={subpage}/>;
  const Icon=page==='integrations'?Plug:page==='operations'?Workflow:ShieldCheck;
  return <section className="pa-advanced"><header className="pa-advanced-head"><div><small>OPERAÇÃO NATIVA / {page.toUpperCase()}</small><h2>{subpage}</h2><p>{description(page,subpage)}</p></div><Icon/></header>{notice&&<div className="pa-notice">{notice}</div>}<div className="pa-kpis module"><article className="pa-kpi"><span>Registros</span><b>{rows.length}</b></article><article className="pa-kpi"><span>Saudáveis</span><b>{rows.filter((x:any)=>['completed','connected','ready','accepted'].includes(x.status)||x.success===1).length}</b></article><article className="pa-kpi"><span>Em andamento</span><b>{rows.filter((x:any)=>['queued','processing'].includes(x.status)).length}</b></article><article className="pa-kpi"><span>Com atenção</span><b>{rows.filter((x:any)=>x.status==='failed'||x.status==='error'||x.success===0||x.lastError).length}</b></article></div><label className="pa-core-search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pesquisar nesta operação"/></label><SystemTable page={page} subpage={subpage} rows={rows} action={async(x:any)=>{if(page==='operations'&&x.status==='failed'){await api(`/platform/jobs/${x.id}/retry`,{method:'POST'});setNotice('Processamento reenfileirado e auditado.');await load()}else if(page==='security'&&subpage==='Sessões ativas'){await api(`/platform/sessions/${x.id}`,{method:'DELETE'});setNotice('Sessão revogada e auditada.');await load()}}}/></section>;
}

function SystemTable({page,subpage,rows,action}:{page:string;subpage:string;rows:any[];action:(x:any)=>void}){
 const heads=page==='integrations'?['Empresa','Conector / evento','Situação','Última atividade']:page==='operations'?['Empresa','Processamento','Situação','Tentativas / ação']:subpage==='Sessões ativas'?['Usuário','Empresa','Criada','Expiração / ação']:['E-mail','Resultado','IP','Data'];
 const cells=(x:any)=>page==='integrations'?[x.companyName,x.name||x.eventType||x.provider,labels[x.status]||x.status,date(x.lastSyncAt||x.occurredAt||x.createdAt)]:page==='operations'?[x.companyName,x.type,labels[x.status]||x.status,<>{x.attempts}{x.status==='failed'&&<button onClick={()=>action(x)}><RefreshCw/> Reprocessar</button>}</>]:subpage==='Sessões ativas'?[x.name,x.companyName,date(x.createdAt),<>{date(x.expiresAt)} <button onClick={()=>action(x)}>Revogar</button></>]:[x.email,x.success?'Permitido':'Negado',x.ip||'—',date(x.createdAt)];
 return <div className="pa-table"><div className="pa-purpose-tr pa-th">{heads.map(h=><span key={h}>{h}</span>)}</div>{rows.length?rows.map((x:any,i:number)=><div className="pa-purpose-tr" key={x.id||i}>{cells(x).map((c:any,j:number)=><span key={j}>{c}</span>)}</div>):<div className="pa-empty">Nenhum dado operacional nesta visão.</div>}</div>
}
function SecurityPolicy({subpage}:{subpage:string}){const map:Record<string,{title:string;text:string;keys:[string,string,string][]}>={
 'Auditoria':{title:'Governança de auditoria',text:'Trilha administrativa imutável, responsável, IP e entidade afetada.',keys:[['audit.retention_days','Retenção dos logs','365'],['audit.export_enabled','Exportação permitida','true']]},
 'Log de alterações':{title:'Política de alterações',text:'Toda mudança administrativa crítica é registrada automaticamente.',keys:[['audit.changes_enabled','Registrar alterações','true']]},
 'LGPD':{title:'Governança LGPD',text:'Parâmetros para solicitações de titulares, prazos e encarregado.',keys:[['lgpd.dpo_email','E-mail do encarregado',''],['lgpd.request_days','Prazo de atendimento','15']]},
 'MFA':{title:'Política global de MFA',text:'Exigência de segundo fator por tipo de identidade.',keys:[['security.mfa_admin','Obrigatório para administradores','true'],['security.mfa_company','Obrigatório para empresas','false']]},
 'Política de senhas':{title:'Política de credenciais',text:'Requisitos globais para novas senhas e bloqueios.',keys:[['security.password_min','Tamanho mínimo','10'],['security.lock_attempts','Tentativas antes do bloqueio','5']]},
 'Controle de permissões':{title:'Controle de acesso',text:'Permissões seguem menor privilégio e segregação por perfil.',keys:[['security.least_privilege','Menor privilégio','true']]}
 };const config=map[subpage]||map.Auditoria,[notice,setNotice]=useState('');return <section className="pa-advanced"><header className="pa-advanced-head"><div><small>SEGURANÇA E GOVERNANÇA</small><h2>{config.title}</h2><p>{config.text}</p></div><KeyRound/></header>{notice&&<div className="pa-notice">{notice}</div>}<form className="pa-card pa-record-form" onSubmit={async e=>{e.preventDefault();await api('/platform/settings',{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});setNotice('Política salva e auditada.')}}>{config.keys.map(([key,label,value])=><label key={key}>{label}<input name={key} defaultValue={value}/></label>)}<button><Activity/> Salvar política</button></form></section>}
function description(page:string,subpage:string){if(page==='integrations')return`Conexões ${subpage}, saúde, eventos e última comunicação por empresa.`;if(page==='operations')return`Processamentos reais de ${subpage}, tentativas, falhas e reexecução controlada.`;return subpage==='Sessões ativas'?'Sessões corporativas ativas com revogação imediata.':'Tentativas administrativas permitidas e bloqueadas, com origem e horário.'}
