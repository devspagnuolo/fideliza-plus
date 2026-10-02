import { useEffect, useRef, useState } from 'react';
import { Building2, Camera, CheckCircle2, Gift, Globe2, MapPin, Save, Trash2 } from 'lucide-react';
import { api } from './api';
import './profile.css';
import { LoyaltyTiers } from './LoyaltyTiers';

const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_LOGO_BYTES = 1_000_000;

export function CompanyProfilePanel() {
  const [company, setCompany] = useState<any>();
  const [message, setMessage] = useState('');
  const [savingLogo, setSavingLogo] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const load = () => api('/company/profile').then(setCompany);

  useEffect(() => { load(); }, []);

  async function uploadLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setMessage('Use uma imagem PNG, JPG ou WebP.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setMessage('Escolha uma imagem de até 1 MB.');
      return;
    }
    const image = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    try {
      setSavingLogo(true);
      await api('/company/logo', { method: 'PUT', body: JSON.stringify({ image }) });
      setMessage('Identidade visual atualizada. A nova logo já será exibida aos seus clientes.');
      await load();
    } catch (reason) {
      setMessage((reason as Error).message);
    } finally {
      setSavingLogo(false);
    }
  }

  async function removeLogo() {
    if (!confirm('Remover a logo personalizada e voltar à identidade padrão da loja?')) return;
    try {
      setSavingLogo(true);
      await api('/company/logo', { method: 'PUT', body: JSON.stringify({ image: null }) });
      setMessage('Logo removida. O portal usará a identidade padrão até uma nova imagem ser enviada.');
      await load();
    } catch (reason) {
      setMessage((reason as Error).message);
    } finally {
      setSavingLogo(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api('/company/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          ...values,
          pointsPerReal: Number(values.pointsPerReal),
          pointsValidityDays: Number(values.pointsValidityDays),
        }),
      });
      setMessage('Perfil empresarial atualizado com sucesso.');
      await load();
    } catch (reason) {
      setMessage((reason as Error).message);
    }
  }

  if (!company) return null;
  return <section className="company-profile-card">
    <div className="company-hero">
      <div className="company-logo">
        {company.logo_data ? <img src={company.logo_data} alt={`Logo de ${company.name}`} /> : <Building2 />}
      </div>
      <div>
        <span>PERFIL EMPRESARIAL</span>
        <h2>{company.name}</h2>
        <p>{company.legal_name || 'Complete os dados legais da empresa'}</p>
      </div>
      <i><CheckCircle2 /> Tenant ativo</i>
    </div>
    <div className="company-brand-editor">
      <div>
        <strong>Identidade visual da loja</strong>
        <p>Esta marca aparece na busca, no login e no portal dos clientes da sua loja.</p>
        <small>PNG, JPG ou WebP · até 1 MB · prefira fundo transparente e formato quadrado.</small>
      </div>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} hidden />
      <button type="button" className="brand-upload" disabled={savingLogo} onClick={() => fileInput.current?.click()}>
        <Camera /> {savingLogo ? 'Salvando...' : company.logo_data ? 'Trocar logo' : 'Enviar logo'}
      </button>
      {company.logo_data && <button type="button" className="brand-remove" disabled={savingLogo} onClick={removeLogo}>
        <Trash2 /> Remover
      </button>}
    </div>
    {message && <div className="settings-message" role="status">{message}</div>}
    <form className="company-form" onSubmit={save}>
      <fieldset>
        <legend><Building2 /> Identificação</legend>
        <label>Nome fantasia<input name="name" defaultValue={company.name} required /></label>
        <label>Razão social<input name="legalName" defaultValue={company.legal_name || ''} /></label>
        <label>CNPJ<input name="cnpj" inputMode="numeric" defaultValue={company.cnpj || ''} placeholder="00.000.000/0000-00" /></label>
        <label>Segmento<input name="segment" defaultValue={company.segment || ''} /></label>
      </fieldset>
      <fieldset>
        <legend><Globe2 /> Contato e presença digital</legend>
        <label>E-mail empresarial<input name="email" type="email" defaultValue={company.email || ''} /></label>
        <label>Telefone<input name="phone" defaultValue={company.phone || ''} /></label>
        <label className="wide">Site<input name="website" type="url" defaultValue={company.website || ''} placeholder="https://" /></label>
      </fieldset>
      <fieldset>
        <legend><MapPin /> Endereço</legend>
        <label className="wide">Endereço<input name="address" defaultValue={company.address || ''} /></label>
        <label>Cidade<input name="city" defaultValue={company.city || ''} /></label>
        <label>Estado<input name="state" maxLength={2} defaultValue={company.state || ''} /></label>
        <label>CEP<input name="postalCode" defaultValue={company.postal_code || ''} /></label>
      </fieldset>
      <fieldset className="loyalty-fieldset">
        <legend><Gift /> Programa de fidelidade</legend>
        <label>Pontos por R$ 1<input name="pointsPerReal" type="number" min="0" step=".1" defaultValue={company.points_per_real} /></label>
        <label>Validade dos pontos<input name="pointsValidityDays" type="number" min="1" defaultValue={company.points_validity_days} /></label>
        <p>Essas regras se aplicam automaticamente às novas vendas.</p>
      </fieldset>
      <button className="company-save"><Save /> Salvar perfil empresarial</button>
    </form>
    <LoyaltyTiers />
  </section>;
}
