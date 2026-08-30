import { Building2, ChevronRight, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { LegalFooter } from './LegalPages';
import './access-hub.css';

export function AccessHub() {
  const [standalone,setStandalone]=useState(false);
  useEffect(()=>{
    const installed=window.matchMedia('(display-mode: standalone)').matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
    if(installed){setStandalone(true);location.replace('/cliente');}
  },[]);
  if(standalone)return <main className="access-hub"><section><BrandLogo full/><p>Abrindo o portal da cliente…</p></section></main>;
  return <main className="access-hub"><section>
    <BrandLogo full />
    <small>ACESSO SEGURO E PERSONALIZADO</small>
    <h1>Como você usa o Fidelizei?</h1>
    <p>Um único aplicativo, com áreas, permissões e experiências separadas para cada perfil.</p>
    <div className="access-options">
      <a href="/login"><Building2 /><span><b>Sou lojista</b><small>Gestão da empresa, clientes, vendas e campanhas.</small></span><ChevronRight /></a>
      <a href="/cliente"><Users /><span><b>Sou cliente</b><small>Encontre sua loja e acesse pontos, extrato e recompensas.</small></span><ChevronRight /></a>
    </div>
    <LegalFooter compact />
  </section></main>;
}
