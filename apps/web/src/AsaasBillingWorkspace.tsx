import { useState } from 'react';
import { CheckCircle2, CircleDollarSign, ExternalLink, RefreshCw, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api } from './api';

const money=(value=0)=>(value/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(value?:string)=>value?new Date(value).toLocaleDateString('pt-BR'):'—';
const statusLabel:Record<string,string>={pending:'Pendente',paid:'Paga',overdue:'Vencida',canceled:'Cancelada',refunded:'Estornada'};

export function AsaasBillingWorkspace({all,refresh}:{all:any;refresh:()=>void}) {
  const [query,setQuery]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
  const invoices=(all.finance?.invoices||[]).filter((item:any)=>item.companyName.toLowerCase().includes(query.toLowerCase()));
  const gateway=all.finance?.gateway||{};
  async function action(path:string,message:string,id='global') {
    setBusy(id);setNotice('');
    try{const result:any=await api(path,{method:'POST'});setNotice(result.failures?.length?`${message} ${result.failures.length} item(ns) exigem revisão.`:message);await refresh()}
    catch(error){setNotice((error as Error).message)}finally{setBusy('')}
  }
  return <section className="pa-module-page">
    <div className="pa-workspace-title"><CircleDollarSign/><div><h2>Cobranças Asaas</h2><p>Emissão, entrega, conciliação por webhook e régua de contas a receber.</p></div></div>
    <div className={`pa-card asaas-health ${gateway.configured?'connected':'pending'}`}>
      {gateway.configured?<ShieldCheck/>:<TriangleAlert/>}<div><b>{gateway.configured?'Gateway configurado':'Configuração pendente'}</b><span>Asaas · {gateway.environment==='production'?'Produção':'Sandbox (sem cobrança real)'}</span></div>
      {gateway.configured&&<button disabled={busy==='webhook'} onClick={()=>action('/platform/asaas/webhook/setup','Webhook do Asaas configurado.','webhook')}>Configurar webhook</button>}
    </div>
    {notice&&<div className="pa-notice">{notice}</div>}
    <div className="pa-kpis module"><article className="pa-kpi"><span>A receber</span><b>{money(invoices.filter((x:any)=>x.status==='pending').reduce((s:number,x:any)=>s+x.amountCents,0))}</b></article><article className="pa-kpi"><span>Recebido</span><b>{money(invoices.filter((x:any)=>x.status==='paid').reduce((s:number,x:any)=>s+x.amountCents,0))}</b></article><article className="pa-kpi"><span>Vencido</span><b>{money(invoices.filter((x:any)=>x.status==='overdue').reduce((s:number,x:any)=>s+x.amountCents,0))}</b></article><article className="pa-kpi"><span>Conciliação automática</span><b>{invoices.filter((x:any)=>x.externalPaymentId).length}</b><small>faturas no gateway</small></article></div>
    <div className="pa-list-tools"><label className="pa-core-search"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Filtrar empresa"/></label><button disabled={busy==='cycle'} onClick={()=>action('/platform/billing/run','Ciclo financeiro concluído.','cycle')}><RefreshCw/> Executar ciclo agora</button></div>
    <div className="pa-table asaas-table"><div className="pa-purpose-tr pa-th"><span>Empresa</span><span>Vencimento</span><span>Método</span><span>Valor / Status</span><span>Ações</span></div>{invoices.length?invoices.map((item:any)=><div className="pa-purpose-tr" key={item.id}><span><b>{item.companyName}</b><small>{item.externalPaymentId?`Asaas ${item.externalPaymentId}`:'Sem cobrança externa'}</small></span><span>{date(item.dueAt)}</span><span>{item.paymentMethod||'—'}<small>{item.externalStatus||item.gateway||'manual'}</small></span><span><b>{money(item.amountCents)}</b><small>{statusLabel[item.status]||item.status}</small></span><span className="asaas-actions">{!item.externalPaymentId&&gateway.configured&&<button disabled={busy===item.id} onClick={()=>action(`/platform/asaas/invoices/${item.id}/generate`,'Cobrança criada no Asaas.',item.id)}>Gerar</button>}{item.externalPaymentId&&<button className="secondary" disabled={busy===item.id} onClick={()=>action(`/platform/asaas/invoices/${item.id}/sync`,'Situação conciliada com o Asaas.',item.id)}><RefreshCw/></button>}{item.invoiceUrl&&<a href={item.invoiceUrl} target="_blank" rel="noreferrer" title="Abrir fatura"><ExternalLink/></a>}{item.bankSlipUrl&&<a href={item.bankSlipUrl} target="_blank" rel="noreferrer" title="Abrir boleto"><CheckCircle2/></a>}</span></div>):<div className="pa-empty">Nenhuma cobrança gerada.</div>}</div>
  </section>
}
