import { useEffect, useState } from 'react';
import { Check, CreditCard, Database, Users } from 'lucide-react';
import { api } from './api';
import './plan-management.css';

const labels: Record<string,string> = {
  core_crm:'CRM e clientes',loyalty:'Fidelidade e pontos',rewards:'Recompensas',customer_portal:'Aplicativo do cliente',erp_integrations:'Integração com qualquer ERP',basic_reports:'Relatórios básicos',campaigns_basic:'Campanhas segmentadas',operational_dashboard:'Dashboard operacional',offers:'Ofertas exclusivas',manager_dashboard:'Dashboard gerencial',campaigns_advanced:'Testes A/B',gie:'Inteligência GIE',public_api:'API pública',advanced_reports:'Relatórios avançados',automations:'Automações',priority_support:'Suporte prioritário',multi_unit:'Multiunidade',audit_export:'Auditoria e exportação'
};
const parse=(value:unknown):string[]=>{try{return Array.isArray(value)?value:JSON.parse(String(value||'[]'))}catch{return[]}};

export function PlanManagement(){
  const[data,setData]=useState<any>(),[message,setMessage]=useState('');
  const load=()=>api('/company/subscription').then(setData);
  useEffect(()=>{void load()},[]);
  if(!data)return null;
  const end=data.subscription.current_period_end?new Date(data.subscription.current_period_end).toLocaleDateString('pt-BR'):'—';
  async function request(event:React.FormEvent<HTMLFormElement>){event.preventDefault();try{await api('/company/subscription/change-requests',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});setMessage('Solicitação enviada para análise do Fidelizei.');load()}catch(error){setMessage((error as Error).message)}}
  return <section className="panel settings-section">
    <div className="section-heading"><CreditCard/><div><h2>Plano e assinatura</h2><p>Capacidade, recursos liberados e evolução do ambiente.</p></div></div>
    <div className="plan-current"><b>{data.subscription.planName}</b><span>{data.subscription.status==='trialing'?`Teste grátis até ${end}`:`Ciclo atual até ${end}`}</span></div>
    <div className="management-kpis"><article><Users/><b>{data.subscription.userLimit}</b><span>usuários</span></article><article><Users/><b>{Number(data.subscription.consumerLimit).toLocaleString('pt-BR')}</b><span>consumidores</span></article><article><Database/><b>{data.subscription.storageMb>=1024?`${data.subscription.storageMb/1024} GB`:`${data.subscription.storageMb} MB`}</b><span>armazenamento</span></article></div>
    <div className="plan-feature-list">{parse(data.subscription.features).map(feature=><span key={feature}><Check/>{labels[feature]||feature}</span>)}</div>
    {message&&<div className="settings-message">{message}</div>}
    <form className="management-form" onSubmit={request}><select name="toPlanCode" required><option value="">Escolha o plano desejado</option>{data.plans.filter((plan:any)=>plan.code!==data.subscription.plan_code).map((plan:any)=><option value={plan.code} key={plan.code}>{plan.name} · {(plan.monthlyPriceCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}/mês</option>)}</select><input name="reason" placeholder="Motivo da alteração" required/><button>Solicitar mudança</button></form>
    {data.requests.map((request:any)=><div className="plan-request" key={request.id}><b>{request.toPlanName}</b><span>{request.status} · {new Date(request.created_at).toLocaleDateString('pt-BR')}</span></div>)}
  </section>
}
