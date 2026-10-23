import { useEffect, useMemo, useState } from 'react';
import { ArchiveRestore, Gift, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from './api';
import './rewards.css';
import './coupon-validation.css';

type Reward = { id: string; name: string; description?: string; points_cost: number; active: number; redemptions: number;reward_type:'coupon';discount_type?:'percent'|'fixed';discount_value?:number;minimum_order_cents:number;valid_from?:string;valid_until?:string;minimum_tier_rank?:number;minimum_tier_name?:string;channel:RewardChannel };
type RewardChannel='app'|'site'|'both';
const channelLabels:Record<RewardChannel,string>={app:'App e loja física',site:'Somente site',both:'App e site'};
type Customer = { id: string; name: string; points_balance: number };
type Tier = { id:string;name:string;rank:number;minLifetimePoints:number };
type Redemption = { id: string; reward_name: string; customer_name: string; customer_cpf?: string; points_spent: number; status: string; redemption_code?: string; order_number?: string; used_at?: string; expires_at?:string; created_at: string };
type Filter = 'active' | 'archived' | 'all';

const today=()=>{const value=new Date();return`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`};
function RewardForm({ reward,tiers,siteIntegration,onCancel, onSaved }: { reward?: Reward;tiers:Tier[];siteIntegration:boolean; onCancel: () => void; onSaved: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const payload = {
      name: String(values.name),
      description: String(values.description || ''),
      pointsCost: Number(values.pointsCost),
      rewardType:'coupon',discountType:String(values.discountType) as 'percent'|'fixed',discountValue:Number(values.discountValue),minimumOrderCents:Math.round(Number(values.minimumOrder||0)*100),
      validFrom:values.validFrom?String(values.validFrom):undefined,validUntil:String(values.validUntil),minimumTierRank:values.minimumTierRank?Number(values.minimumTierRank):null,
      ...(values.channel?{channel:String(values.channel) as RewardChannel}:{}),
    };
    try {
      await api(reward ? `/rewards/${reward.id}` : '/rewards', { method: reward ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      onSaved(reward ? 'Recompensa atualizada com sucesso.' : 'Recompensa criada e publicada no catálogo.');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return <div className="reward-modal-bg" role="dialog" aria-modal="true" aria-label={reward ? 'Editar recompensa' : 'Nova recompensa'}>
    <form className="reward-modal" onSubmit={submit}>
      <button type="button" className="reward-close" onClick={onCancel} aria-label="Fechar"><X /></button>
      <small>GESTÃO DO CATÁLOGO</small>
      <h3>{reward ? 'Editar recompensa' : 'Nova recompensa'}</h3>
      <p>Defina o cupom, sua vigência e o nível de relacionamento elegível. Não há limite por quantidade; cada código resgatado continua sendo único.</p>
      <label>Nome do benefício<input name="name" defaultValue={reward?.name || ''} maxLength={100} required autoFocus /></label>
      <label>Descrição<textarea name="description" defaultValue={reward?.description || ''} maxLength={500} rows={3} /></label>
      <div className="reward-form-grid">
        <label>Custo em pontos<input name="pointsCost" type="number" min="1" step="1" defaultValue={reward?.points_cost || ''} required /></label>
        <label>Nível mínimo<select name="minimumTierRank" defaultValue={reward?.minimum_tier_rank||''}><option value="">Todos os níveis</option>{tiers.map(tier=><option value={tier.rank} key={tier.id}>{tier.name} e superiores</option>)}</select></label>
      </div>
      {siteIntegration&&<fieldset className="reward-channel"><legend>Onde a recompensa fica disponível</legend>
        {(['app','site','both'] as RewardChannel[]).map(channel=><label key={channel}><input type="radio" name="channel" value={channel} defaultChecked={(reward?.channel||'both')===channel}/><span><b>{channelLabels[channel]}</b><small>{channel==='app'?'Resgate no App e apresentação do código no PDV.':channel==='site'?'Aparece apenas no checkout do site, conforme os pontos do cliente.':'Aparece no checkout do site e fica disponível para resgate no App.'}</small></span></label>)}
      </fieldset>}
      <div className="reward-form-grid"><label>Início da vigência<input name="validFrom" type="date" min={today()} defaultValue={reward?.valid_from||today()}/></label><label>Válido até<input name="validUntil" type="date" min={reward?.valid_from||today()} defaultValue={reward?.valid_until||''} required/></label></div>
      <div className="reward-form-grid"><label>Tipo do desconto<select name="discountType" defaultValue={reward?.discount_type||'percent'}><option value="percent">Percentual (%)</option><option value="fixed">Valor fixo (centavos)</option></select></label><label>Valor do desconto<input name="discountValue" type="number" min="1" defaultValue={reward?.discount_value||''} required/></label><label>Pedido mínimo (R$)<input name="minimumOrder" type="number" min="0" step="0.01" defaultValue={(reward?.minimum_order_cents||0)/100}/></label></div>
      {error && <div className="reward-error">{error}</div>}
      <div className="reward-modal-actions"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button disabled={saving}>{saving ? 'Salvando…' : reward ? 'Salvar alterações' : 'Criar recompensa'}</button></div>
    </form>
  </div>;
}

export function RewardsCatalog() {
  const [items, setItems] = useState<Reward[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tiers,setTiers]=useState<Tier[]>([]);
  const [siteIntegration,setSiteIntegration]=useState(false);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [editing, setEditing] = useState<Reward | 'new' | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = async () => {
    const [rewards, customerList, redemptionList,tierList,channels] = await Promise.all([api<Reward[]>('/rewards'), api<Customer[]>('/customers'), api<Redemption[]>('/reward-redemptions'),api<{items:Tier[]}>('/loyalty/tiers'),api<{siteIntegration:boolean}>('/rewards/channels')]);
    setItems(rewards);
    setCustomers(customerList);
    setRedemptions(redemptionList);
    setTiers(tierList.items);
    setSiteIntegration(channels.siteIntegration);
  };
  useEffect(() => { load().catch(reason => setError((reason as Error).message)); }, []);
  const visible = useMemo(() => items.filter(item => filter === 'all' || (filter === 'active' ? item.active : !item.active)), [items, filter]);

  async function saved(text: string) {
    setEditing(null);
    setMessage(text);
    setError('');
    await load();
  }
  async function redeem(event: React.FormEvent<HTMLFormElement>, reward: Reward) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api<{ reward: string; pointsSpent: number; balance: number }>(`/rewards/${reward.id}/redeem`, { method: 'POST', body: JSON.stringify({ customerId: values.customerId }) });
      setMessage(`${result.reward} resgatado por ${result.pointsSpent} pontos. Saldo restante: ${result.balance}.`);
      setError('');
      await load();
    } catch (reason) { setError((reason as Error).message); }
  }
  async function remove(reward: Reward) {
    if (!confirm(`Excluir “${reward.name}” do catálogo? O histórico de resgates será preservado.`)) return;
    try {
      const result = await api<{ deleted: boolean; archived: boolean }>(`/rewards/${reward.id}`, { method: 'DELETE' });
      setMessage(result.archived ? 'Recompensa arquivada. Os resgates anteriores foram preservados.' : 'Recompensa excluída definitivamente.');
      setError('');
      await load();
    } catch (reason) { setError((reason as Error).message); }
  }
  async function restore(reward: Reward) {
    try {
      await api(`/rewards/${reward.id}`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
      await saved('Recompensa reativada e disponível novamente.');
    } catch (reason) { setError((reason as Error).message); }
  }
  async function validateCoupon(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      const result = await api<{ reward: string; customer: string; orderNumber: string }>('/reward-redemptions/validate', { method: 'POST', body: JSON.stringify(values) });
      setMessage(`${result.reward} utilizado por ${result.customer} e vinculado ao pedido ${result.orderNumber}.`);
      setError('');
      form.reset();
      await load();
    } catch (reason) { setError((reason as Error).message); }
  }

  return <section className="panel rewards">
    <div className="panel-title reward-title">
      <div className="ai"><Gift /></div>
      <div><h2>Cupons por pontos</h2><p>Gerencie exclusivamente benefícios trocados por pontos. Produtos com preço exclusivo ficam em “Ofertas da loja”.</p></div>
      <button className="icon-button" onClick={() => setEditing('new')} title="Nova recompensa" aria-label="Nova recompensa"><Plus /></button>
    </div>
    <div className="reward-toolbar">
      <div className="reward-summary"><strong>{items.filter(item => item.active).length}</strong><span>ativas</span><strong>{items.reduce((sum, item) => sum + Number(item.redemptions || 0), 0)}</strong><span>resgates</span></div>
      <div className="reward-filters" aria-label="Filtrar catálogo">
        <button className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>Ativas</button>
        <button className={filter === 'archived' ? 'active' : ''} onClick={() => setFilter('archived')}>Arquivadas</button>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas</button>
      </div>
    </div>
    {message && <div className="campaign-feedback">{message}</div>}
    {error && <div className="reward-error">{error}</div>}
    <section className="reward-validation">
      <div><small>VALIDAÇÃO NO CAIXA</small><h3>Utilizar cupom por código</h3><p>Informe o código apresentado pelo cliente e vincule o benefício ao pedido de venda.</p></div>
      <form onSubmit={validateCoupon}><label>Código do cupom<input name="code" placeholder="FZ-XXXXXXXX" autoComplete="off" required/></label><label>Número do pedido<input name="orderNumber" placeholder="Ex.: 25781" required/></label><button>Validar e vincular</button></form>
    </section>
    <section className="reward-redemption-log"><header><div><small>HISTÓRICO AUDITÁVEL</small><h3>Resgates recentes</h3></div><span>{redemptions.length} registro(s)</span></header>{redemptions.length?redemptions.slice(0,20).map(item=><div key={item.id}><span><b>{item.reward_name}</b><small>{item.customer_name}{item.customer_cpf?` · CPF final ${item.customer_cpf.slice(-4)}`:''}</small></span><span className={`reward-use-status ${item.status}`}>{item.status==='confirmed'?'Disponível':item.status==='ready_for_use'?'Aguardando caixa':item.status==='used'?'Utilizado':item.status}</span><span><b>{item.redemption_code||'Código não gerado'}</b><small>{item.order_number?`Pedido ${item.order_number}`:item.expires_at?`Válido até ${new Date(`${item.expires_at}T12:00:00`).toLocaleDateString('pt-BR')}`:new Date(item.created_at).toLocaleDateString('pt-BR')}</small></span></div>):<p>Nenhum resgate registrado.</p>}</section>
    <div className="reward-grid">
      {visible.map(item => <article key={item.id} className={!item.active ? 'archived' : ''}>
        <header><span className={item.active&&item.channel!=='site'&&(!item.valid_from||item.valid_from<=today())&&(!item.valid_until||item.valid_until>=today())?'reward-status active':'reward-status'}>{!item.active?'Arquivada':item.valid_from&&item.valid_from>today()?'Agendada':item.valid_until&&item.valid_until<today()?'Vencida':'Ativa'}</span><span>{item.redemptions || 0} resgate(s)</span></header>
        <div><small>CUPOM{item.minimum_tier_name?` · ${item.minimum_tier_name} E SUPERIORES`:''}</small>{siteIntegration&&<span className={`reward-channel-badge ${item.channel}`}>{channelLabels[item.channel]}</span>}<h3>{item.name}</h3><p>{item.description || 'Benefício exclusivo Fidelizei'}</p><b>{item.discount_type==='percent'&&item.discount_value?`${item.discount_value}% de desconto`:item.discount_type==='fixed'&&item.discount_value?`${(item.discount_value/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} de desconto`:'Desconto não configurado — edite a recompensa'}</b>{item.minimum_order_cents>0&&<small>Pedido mínimo: {(item.minimum_order_cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</small>}<b>{item.points_cost.toLocaleString('pt-BR')} pontos</b><small>{item.valid_until?`Válido até ${new Date(`${item.valid_until}T12:00:00`).toLocaleDateString('pt-BR')}`:'Validade não definida'}</small></div>
        <div className="reward-manage">
          <button className="secondary" onClick={() => setEditing(item)}><Pencil /> Editar</button>
          {item.active ? <button className="danger" onClick={() => remove(item)}><Trash2 /> Excluir</button> : <button className="secondary" onClick={() => restore(item)}><ArchiveRestore /> Reativar</button>}
        </div>
        {item.active&&(!item.valid_from||item.valid_from<=today())&&(!item.valid_until||item.valid_until>=today()) && <form onSubmit={event => redeem(event, item)}>
          <label>Resgate assistido<select name="customerId" required><option value="">Selecionar cliente</option>{customers.filter(customer => customer.points_balance >= item.points_cost).map(customer => <option value={customer.id} key={customer.id}>{customer.name} · {customer.points_balance} pts</option>)}</select></label>
          <button>Resgatar benefício</button>
        </form>}
      </article>)}
      {!visible.length && <div className="reward-empty"><Gift /><b>Nenhuma recompensa nesta visão</b><span>{filter === 'active' ? 'Crie o primeiro benefício para seus clientes.' : 'As recompensas removidas com histórico aparecerão aqui.'}</span></div>}
    </div>
    {editing && <RewardForm reward={editing === 'new' ? undefined : editing} tiers={tiers} siteIntegration={siteIntegration} onCancel={() => setEditing(null)} onSaved={saved} />}
  </section>;
}
