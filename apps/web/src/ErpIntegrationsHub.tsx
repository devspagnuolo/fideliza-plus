import { useEffect,useMemo,useState } from 'react';
import { AlertCircle,CheckCircle2,ExternalLink,Layers3,RefreshCw,ShieldCheck } from 'lucide-react';
import { api } from './api';
import './erp-integrations.css';

type ProviderStatus='available'|'in_development'|'planned'|'partner_required'|'product_specific';
type Provider={code:string;name:string;status:ProviderStatus;priority:number;authType:string;capabilities:string[];description:string;requirements:string[];documentationUrl:string;productScope?:string;canConnect:boolean;connection?:{status:string;lastSyncAt?:string|null;lastError?:string|null}|null};
type Catalog={providers:Provider[];recentRuns:Array<{id:string;provider:string;status:string;startedAt:string;errorMessage?:string|null}>};
const labels:Record<ProviderStatus,string>={available:'Disponível',in_development:'Em desenvolvimento',planned:'Planejado',partner_required:'Depende de parceria',product_specific:'Por produto/versão'};
const capabilityLabels:Record<string,string>={customers:'Clientes',sales:'Vendas',cancellations:'Cancelamentos',products:'Produtos',inventory:'Estoque',webhooks:'Webhooks',scheduled_sync:'Sincronização agendada',automatic_token_refresh:'Renovação automática'};

export function ErpIntegrationsHub(){
  const[data,setData]=useState<Catalog>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=async()=>{setBusy(true);setError('');try{setData(await api<Catalog>('/integrations/erp/catalog'));}catch(reason){setError((reason as Error).message);}finally{setBusy(false)}};
  useEffect(()=>{void load()},[]);
  const summary=useMemo(()=>({available:data?.providers.filter(item=>item.status==='available').length??0,next:data?.providers.filter(item=>item.priority===1&&item.status!=='available').length??0,connected:data?.providers.filter(item=>item.connection).length??0}),[data]);
  return <section className="panel erp-hub">
    <header><div><span className="erp-eyebrow"><Layers3/> ARQUITETURA MULTI-ERP</span><h2>Central de conectores ERP</h2><p>Capacidades e disponibilidade reais. Credenciais só são solicitadas quando o adaptador está implementado e homologado.</p></div><button className="secondary" onClick={()=>void load()} disabled={busy}><RefreshCw className={busy?'spin':''}/> Atualizar</button></header>
    {error&&<div className="erp-error"><AlertCircle/>{error}</div>}
    <div className="erp-summary"><article><b>{summary.connected}</b><span>conectado(s)</span></article><article><b>{summary.available}</b><span>disponível(is)</span></article><article><b>{summary.next}</b><span>na primeira onda</span></article></div>
    <div className="erp-grid">{data?.providers.map(provider=><article className={`erp-card ${provider.status}`} key={provider.code}>
      <div className="erp-card-head"><span><b>{provider.name}</b><small>{provider.connection?`Conexão: ${provider.connection.status}`:labels[provider.status]}</small></span>{provider.status==='available'?<CheckCircle2/>:<ShieldCheck/>}</div>
      <p>{provider.description}</p>{provider.productScope&&<small className="erp-scope">{provider.productScope}</small>}
      <div className="erp-capabilities">{provider.capabilities.map(capability=><span key={capability}>{capabilityLabels[capability]??capability}</span>)}</div>
      <details><summary>Requisitos técnicos</summary><ul>{provider.requirements.map(item=><li key={item}>{item}</li>)}</ul></details>
      <footer><a href={provider.documentationUrl} target="_blank" rel="noreferrer">Documentação oficial <ExternalLink/></a>{provider.code==='bling'&&<span>Gerencie a conexão no painel abaixo</span>}</footer>
    </article>)}</div>
  </section>;
}
