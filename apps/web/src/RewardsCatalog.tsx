import { useEffect, useMemo, useState } from 'react';
import { ArchiveRestore, Gift, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from './api';
import './rewards.css';
import './coupon-validation.css';

type Reward = { id: string; name: string; description?: string; points_cost: number; stock: number | null; active: number; redemptions: number };
type Customer = { id: string; name: string; points_balance: number };
type Redemption = { id: string; reward_name: string; customer_name: string; customer_cpf?: string; points_spent: number; status: string; redemption_code?: string; order_number?: string; used_at?: string; created_at: string };
type Filter = 'active' | 'archived' | 'all';

function RewardForm({ reward, onCancel, onSaved }: { reward?: Reward; onCancel: () => void; onSaved: (message: string) => void }) {
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
      stock: values.stock === '' ? null : Number(values.stock),
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
      <p>Defina o benefício, o custo em pontos e o estoque disponível.</p>
      <label>Nome do benefício<input name="name" defaultValue={reward?.name || ''} maxLength={100} required autoFocus /></label>
      <label>Descrição<textarea name="description" defaultValue={reward?.description || ''} maxLength={500} rows={3} /></label>
      <div className="reward-form-grid">
        <label>Custo em pontos<input name="pointsCost" type="number" min="1" step="1" defaultValue={reward?.points_cost || ''} required /></label>
        <label>Estoque <small>Deixe vazio para ilimitado</small><input name="stock" type="number" min="0" step="1" defaultValue={reward?.stock ?? ''} /></label>
      </div>
      {error && <div className="reward-error">{error}</div>}
      <div className="reward-modal-actions"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button disabled={saving}>{saving ? 'Salvando…' : reward ? 'Salvar alterações' : 'Criar recompensa'}</button></div>
    </form>
  </div>;
}

export function RewardsCatalog() {
  const [items, setItems] = useState<Reward[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [editing, setEditing] = useState<Reward | 'new' | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = async () => {
    const [rewards, customerList, redemptionList] = await Promise.all([api<Reward[]>('/rewards'), api<Customer[]>('/customers'), api<Redemption[]>('/reward-redemptions')]);
    setItems(rewards);
    setCustomers(customerList);
    setRedemptions(redemptionList);
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
      <div><h2>Catálogo de recompensas</h2><p>Crie, edite, arquive e acompanhe os benefícios oferecidos aos seus clientes.</p></div>
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
    <section className="reward-redemption-log"><header><div><small>HISTÓRICO AUDITÁVEL</small><h3>Resgates recentes</h3></div><span>{redemptions.length} registro(s)</span></header>{redemptions.length?redemptions.slice(0,20).map(item=><div key={item.id}><span><b>{item.reward_name}</b><small>{item.customer_name}{item.customer_cpf?` · CPF final ${item.customer_cpf.slice(-4)}`:''}</small></span><span className={`reward-use-status ${item.status}`}>{item.status==='confirmed'?'Disponível':item.status==='ready_for_use'?'Aguardando caixa':item.status==='used'?'Utilizado':item.status}</span><span><b>{item.redemption_code||'Código não gerado'}</b><small>{item.order_number?`Pedido ${item.order_number}`:new Date(item.created_at).toLocaleDateString('pt-BR')}</small></span></div>):<p>Nenhum resgate registrado.</p>}</section>
    <div className="reward-grid">
      {visible.map(item => <article key={item.id} className={!item.active ? 'archived' : ''}>
        <header><span className={item.active ? 'reward-status active' : 'reward-status'}>{item.active ? 'Ativa' : 'Arquivada'}</span><span>{item.redemptions || 0} resgate(s)</span></header>
        <div><h3>{item.name}</h3><p>{item.description || 'Benefício exclusivo Fideliza Plus'}</p><b>{item.points_cost.toLocaleString('pt-BR')} pontos</b><small>{item.stock === null ? 'Estoque ilimitado' : `${item.stock} disponível(is)`}</small></div>
        <div className="reward-manage">
          <button className="secondary" onClick={() => setEditing(item)}><Pencil /> Editar</button>
          {item.active ? <button className="danger" onClick={() => remove(item)}><Trash2 /> Excluir</button> : <button className="secondary" onClick={() => restore(item)}><ArchiveRestore /> Reativar</button>}
        </div>
        {item.active && <form onSubmit={event => redeem(event, item)}>
          <label>Resgate assistido<select name="customerId" required><option value="">Selecionar cliente</option>{customers.filter(customer => customer.points_balance >= item.points_cost).map(customer => <option value={customer.id} key={customer.id}>{customer.name} · {customer.points_balance} pts</option>)}</select></label>
          <button disabled={item.stock === 0}>Resgatar benefício</button>
        </form>}
      </article>)}
      {!visible.length && <div className="reward-empty"><Gift /><b>Nenhuma recompensa nesta visão</b><span>{filter === 'active' ? 'Crie o primeiro benefício para seus clientes.' : 'As recompensas removidas com histórico aparecerão aqui.'}</span></div>}
    </div>
    {editing && <RewardForm reward={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSaved={saved} />}
  </section>;
}
