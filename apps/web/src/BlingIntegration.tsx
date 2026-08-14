import { useEffect,useState } from 'react';
import { Link2,RefreshCw,Unplug } from 'lucide-react';
import { api } from './api';
import './bling.css';

type Status={configured:boolean;connected:boolean;connection?:{status:string;expires_at:string;last_sync_at?:string;created_at:string}|null};

export function BlingIntegration(){
  const [status,setStatus]=useState<Status>();
  const [message,setMessage]=useState('');
  const load=()=>api<Status>('/integrations/bling').then(setStatus).catch(reason=>setMessage((reason as Error).message));
  useEffect(()=>{load();},[]);
  async function connect(){try{const result=await api<{url:string}>('/integrations/bling/authorize',{method:'POST'});location.assign(result.url);}catch(reason){setMessage((reason as Error).message);}}
  async function disconnect(){if(!confirm('Desconectar o Bling da Vivi Moda? Os dados já importados serão preservados.'))return;await api('/integrations/bling',{method:'DELETE'});setMessage('Bling desconectado.');load();}
  return <section className="panel integration-panel"><div className="panel-title"><div className="integration-icon"><Link2/></div><div><h2>Integração Bling</h2><p>Base segura para sincronizar clientes e vendas sem bloquear a operação manual.</p></div><span className={status?.connected?'badge':'draft'}>{status?.connected?'Conectado':status?.configured?'Pronto para conectar':'Não configurado'}</span></div>{status?.connected?<div className="integration-actions"><span>Conectado em {new Date(status.connection!.created_at).toLocaleDateString('pt-BR')}<small>{status.connection?.last_sync_at?`Última sincronização: ${new Date(status.connection.last_sync_at).toLocaleString('pt-BR')}`:'A sincronização incremental será ativada na próxima etapa.'}</small></span><button className="secondary" onClick={disconnect}><Unplug size={17}/> Desconectar</button></div>:<div className="integration-actions"><span>{status?.configured?'Autorize o Fideliza+ no Bling para concluir a conexão.':'Informe as credenciais BLING_CLIENT_ID e BLING_CLIENT_SECRET quando desejar ativar. O MVP continua funcionando normalmente.'}</span><button className="secondary" disabled={!status?.configured} onClick={connect}><RefreshCw size={17}/> Conectar Bling</button></div>}{message&&<small className="integration-message">{message}</small>}</section>;
}
