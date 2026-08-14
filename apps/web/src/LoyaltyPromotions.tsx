import { useEffect, useState } from 'react';
import { Gift, Plus } from 'lucide-react';
import { api } from './api';

type Promotion = { id:string; name:string; multiplier:number; starts_at:string; ends_at:string; active:number };

export function LoyaltyPromotions() {
  const [items,setItems]=useState<Promotion[]>([]);
  const [open,setOpen]=useState(false);
  const load=()=>api<Promotion[]>('/loyalty/promotions').then(setItems);
  useEffect(()=>{load();},[]);

  async function create(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values=Object.fromEntries(new FormData(event.currentTarget));
    await api('/loyalty/promotions',{method:'POST',body:JSON.stringify({name:values.name,multiplier:Number(values.multiplier),startsAt:new Date(String(values.startsAt)).toISOString(),endsAt:new Date(String(values.endsAt)).toISOString()})});
    setOpen(false);load();
  }

  async function toggle(item:Promotion) {
    await api(`/loyalty/promotions/${item.id}/status`,{method:'PATCH',body:JSON.stringify({active:!item.active})});load();
  }

  return <section className="panel promotions"><div className="panel-title"><div className="ai"><Gift/></div><div><h2>Campanhas de pontos extras</h2><p>Multiplique os pontos automaticamente durante um período.</p></div><button className="secondary push" onClick={()=>setOpen(!open)}><Plus size={17}/> Nova regra</button></div>{open&&<form className="inline-form" onSubmit={create}><input name="name" placeholder="Ex.: Semana em dobro" required/><input name="multiplier" type="number" min="1.1" max="10" step="0.1" placeholder="Multiplicador" required/><input name="startsAt" type="datetime-local" required/><input name="endsAt" type="datetime-local" required/><button>Criar campanha</button></form>}<div className="promotion-list">{items.map(item=><article key={item.id}><div><b>{item.name}</b><small>{new Date(item.starts_at).toLocaleDateString('pt-BR')} até {new Date(item.ends_at).toLocaleDateString('pt-BR')}</small></div><strong>{item.multiplier}x</strong><button className={item.active?'badge':'draft'} onClick={()=>toggle(item)}>{item.active?'Ativa':'Pausada'}</button></article>)}{!items.length&&<small>Nenhuma campanha de pontos extras criada.</small>}</div></section>;
}
