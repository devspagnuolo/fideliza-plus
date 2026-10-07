import { FormEvent,useEffect,useState } from 'react';
import { Building2,Download,Plus,ShieldCheck } from 'lucide-react';
import { API_URL,api } from './api';

type Unit={id:string;name:string;active:number;created_at:string};
type Audit={action:string;entity_type:string;entity_id?:string;metadata?:string;created_at:string};

export function GovernanceWorkspace({features}:{features:string[]}){
 const multiUnit=features.includes('multi_unit'),auditExport=features.includes('audit_export');
 const[units,setUnits]=useState<Unit[]>([]),[audit,setAudit]=useState<Audit[]>([]),[message,setMessage]=useState('');
 const load=()=>{if(multiUnit)api<Unit[]>('/units').then(setUnits);if(auditExport)api<Audit[]>('/audit').then(setAudit)};
 useEffect(load,[multiUnit,auditExport]);
 async function createUnit(event:FormEvent<HTMLFormElement>){event.preventDefault();try{await api('/units',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});event.currentTarget.reset();setMessage('Unidade criada e registrada na auditoria.');load()}catch(reason){setMessage((reason as Error).message)}}
 return <><header><div><span className="eyebrow">GOVERNANÇA</span><h1>Operação multiunidade e auditoria</h1><p>Recursos profissionais liberados pela sua assinatura, com rastreabilidade centralizada.</p></div></header>{message&&<div className="settings-message">{message}</div>}<div className="settings-tabs">{multiUnit&&<section className="panel settings-section"><div className="section-heading"><Building2/><div><h2>Unidades da operação</h2><p>Cadastre filiais e pontos de operação vinculados à empresa.</p></div></div><form className="management-form" onSubmit={createUnit}><input name="name" placeholder="Nome da unidade" minLength={2} required/><button><Plus/> Adicionar unidade</button></form><div className="team-list">{units.map(unit=><div key={unit.id}><span><b>{unit.name}</b><small>Criada em {new Date(unit.created_at).toLocaleDateString('pt-BR')}</small></span><i className={unit.active?'badge':'draft'}>{unit.active?'Ativa':'Inativa'}</i></div>)}</div></section>}{auditExport&&<section className="panel settings-section"><div className="section-heading"><ShieldCheck/><div><h2>Trilha de auditoria</h2><p>Últimas ações executadas por usuários e integrações da empresa.</p></div><a className="secondary" href={`${API_URL}/audit/export`}><Download/> Exportar CSV</a></div><div className="team-list">{audit.map((entry,index)=><div key={`${entry.created_at}-${index}`}><span><b>{entry.action}</b><small>{entry.entity_type}{entry.entity_id?` · ${entry.entity_id}`:''}</small></span><span>{new Date(entry.created_at).toLocaleString('pt-BR')}</span></div>)}</div></section>}</div></>
}
