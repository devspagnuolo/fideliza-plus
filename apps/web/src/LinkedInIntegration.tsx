import { useEffect,useState } from 'react';
import { AlertTriangle,CheckCircle2,Linkedin,RefreshCw,Unplug } from 'lucide-react';
import { api } from './api';
import './bling.css';
import './linkedin.css';

type CapabilityKey='tokenValidation'|'memberPublishing'|'organizationPublishing'|'organizationAnalytics';
type Status={configured:boolean;connected:boolean;expired:boolean;requestedScopes:string[];capabilities:Record<CapabilityKey,boolean>;connection?:{status:string;expiresAt:string;createdAt:string;updatedAt:string;scopes:string[];lastError?:string|null;lastVerifiedAt?:string|null}|null};
const capabilities:Array<{key:CapabilityKey;label:string;description:string}>=[
  {key:'tokenValidation',label:'Autorização técnica',description:'Token validado diretamente no LinkedIn; não é uma forma de login no Fidelizei.'},
  {key:'memberPublishing',label:'Publicação pessoal',description:'Exige o produto Share on LinkedIn e o escopo w_member_social.'},
  {key:'organizationPublishing',label:'Página da empresa',description:'Exige aprovação da Community Management API e função administrativa na página.'},
  {key:'organizationAnalytics',label:'Analytics institucional',description:'Exige acesso aprovado para leitura da página da empresa.'},
];

export function LinkedInIntegration(){
  const[status,setStatus]=useState<Status>();const[message,setMessage]=useState('');const[busy,setBusy]=useState(false);
  const load=()=>api<Status>('/integrations/linkedin').then(setStatus).catch(reason=>setMessage((reason as Error).message));
  useEffect(()=>{const result=new URLSearchParams(location.search).get('linkedin');if(result==='connected'){setMessage('LinkedIn conectado e identidade validada.');history.replaceState({},'',location.pathname);}load();},[]);
  async function connect(){try{setBusy(true);const result=await api<{url:string}>('/integrations/linkedin/authorize',{method:'POST'});location.assign(result.url);}catch(reason){setMessage((reason as Error).message);setBusy(false);}}
  async function test(){try{setBusy(true);const result=await api<{healthy:boolean}>('/integrations/linkedin/test',{method:'POST'});setMessage(result.healthy?'Conexão validada diretamente no LinkedIn.':'Não foi possível validar a conexão.');await load();}catch(reason){setMessage((reason as Error).message);}finally{setBusy(false);}}
  async function disconnect(){if(!confirm('Desconectar o LinkedIn? Nenhum conteúdo já publicado será removido.'))return;try{setBusy(true);await api('/integrations/linkedin',{method:'DELETE'});setMessage('LinkedIn desconectado com segurança.');await load();}catch(reason){setMessage((reason as Error).message);}finally{setBusy(false);}}
  return <section className="panel integration-panel linkedin-panel"><div className="panel-title"><div className="integration-icon linkedin-icon"><Linkedin/></div><div><h2>LinkedIn</h2><p>Autorize a integração de comunicação profissional. O LinkedIn não será usado para entrar no Fidelizei.</p></div><span className={status?.connected?'badge':status?.expired?'warning':'draft'}>{status?.connected?'Conectado':status?.expired?'Autorização expirada':status?.configured?'Pronto para conectar':'Não configurado'}</span></div>
    {status?.connected&&<div className="linkedin-identity"><div><strong>Integração autorizada</strong><span>Uso restrito aos recursos de comunicação liberados pela LinkedIn.</span><small>Autorização válida até {new Date(status.connection!.expiresAt).toLocaleString('pt-BR')}</small></div></div>}
    <div className="linkedin-capabilities">{capabilities.map(item=>{const enabled=Boolean(status?.capabilities[item.key]);return <article className={enabled?'enabled':''} key={item.key}>{enabled?<CheckCircle2/>:<AlertTriangle/>}<div><strong>{item.label}</strong><span>{item.description}</span></div></article>})}</div>
    {status?.connected?<div className="integration-actions"><span>{status.connection?.lastVerifiedAt?`Validado em ${new Date(status.connection.lastVerifiedAt).toLocaleString('pt-BR')}`:'Conexão aguardando teste operacional.'}<small>{status.connection?.lastError||'Os recursos são habilitados somente conforme os escopos aprovados pela LinkedIn.'}</small></span><div className="integration-buttons"><button className="secondary" disabled={busy} onClick={test}><RefreshCw size={17}/> {busy?'Validando…':'Testar conexão'}</button><button className="secondary" disabled={busy} onClick={disconnect}><Unplug size={17}/> Desconectar</button></div></div>:<div className="integration-actions"><span>{status?.configured?'A autorização abrirá o LinkedIn e retornará ao Fidelizei após o consentimento.':'Cadastre LINKEDIN_CLIENT_ID e LINKEDIN_CLIENT_SECRET no serviço da API para liberar a conexão.'}<small>O endereço de retorno deve ser exatamente o mesmo cadastrado no portal de desenvolvedores.</small></span><button className="secondary" disabled={!status?.configured||busy} onClick={connect}><Linkedin size={17}/> {status?.expired?'Reconectar LinkedIn':'Conectar LinkedIn'}</button></div>}
    {message&&<small className="integration-message" role="status">{message}</small>}</section>;
}
