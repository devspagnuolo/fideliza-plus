import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Search, ShieldCheck, Store } from 'lucide-react';
import { api } from './api';
import { BrandLogo } from './BrandLogo';
import { LegalFooter } from './LegalPages';
import './customer-store-finder.css';

type StoreProgram = { name: string; slug: string; segment?: string; logoData?: string };

export function CustomerStoreFinder() {
  const [stores, setStores] = useState<StoreProgram[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const lastStore = localStorage.getItem('fideliza:last-store');
  useEffect(() => {
    api<StoreProgram[]>('/customer/stores').then(items => {
      setStores([...items].sort((a, b) => a.slug === lastStore ? -1 : b.slug === lastStore ? 1 : a.name.localeCompare(b.name, 'pt-BR')));
    }).catch(reason => setError((reason as Error).message)).finally(() => setLoading(false));
  }, [lastStore]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    return normalized ? stores.filter(store => `${store.name} ${store.segment || ''}`.toLocaleLowerCase('pt-BR').includes(normalized)) : stores;
  }, [query, stores]);
  return <main className="store-finder">
    <section>
      <a className="store-back" href="/acesso"><ArrowLeft /> Voltar</a>
      <BrandLogo full />
      <small>PORTAL DO CLIENTE</small>
      <h1>Encontre sua loja</h1>
      <p>Escolha onde você participa do Fidelizei para consultar pontos, extrato e recompensas.</p>
      <label className="store-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar pelo nome da loja" aria-label="Buscar loja" /></label>
      <div className="store-results" aria-live="polite">
        {loading && <div className="store-message">Carregando programas disponíveis…</div>}
        {error && <div className="store-message error">Não foi possível carregar as lojas. Tente novamente em instantes.</div>}
        {!loading && !error && visible.map(store => <a key={store.slug} href={`/cliente/${encodeURIComponent(store.slug)}`} onClick={() => localStorage.setItem('fideliza:last-store', store.slug)}>
          <span className="store-logo">{store.logoData ? <img src={store.logoData} alt="" /> : <Store />}</span>
          <span><b>{store.name}</b><small>{store.segment || 'Programa de fidelidade'}</small>{store.slug === lastStore && <em>Acesso recente</em>}</span>
          <ArrowRight />
        </a>)}
        {!loading && !error && !visible.length && <div className="store-message"><Store /><b>Nenhuma loja encontrada</b><span>Confira o nome informado ou solicite o link à loja.</span></div>}
      </div>
      <footer><ShieldCheck /> Seus dados e seu saldo ficam separados e protegidos em cada loja.</footer>
      <LegalFooter compact />
    </section>
  </main>;
}
