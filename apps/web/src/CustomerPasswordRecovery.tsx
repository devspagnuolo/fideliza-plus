import { useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { api } from './api';
import { BrandLogo } from './BrandLogo';
import { LegalFooter } from './LegalPages';
import './recovery.css';

export function CustomerPasswordRecovery({ slug }: { slug: string }) {
  const token = new URLSearchParams(location.search).get('token');
  const [store, setStore] = useState<{ name: string }>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ name: string }>(`/customer/store/${encodeURIComponent(slug)}`).then(setStore).catch(() => undefined); }, [slug]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      if (token) {
        if (values.password !== values.confirmPassword) throw new Error('As senhas não coincidem.');
        await api('/customer/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password: values.password }) });
        setMessage('Senha redefinida com sucesso. Você já pode voltar e entrar no programa.');
      } else {
        const result = await api<{ message: string }>('/customer/auth/forgot-password', { method: 'POST', body: JSON.stringify({ tenantSlug: slug, cpf: values.cpf, email: values.email }) });
        setMessage(result.message);
      }
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <main className="customer-recovery"><section><BrandLogo full/><div className="recovery-store"><span><KeyRound/></span><div><small>RECUPERAÇÃO SEGURA</small><h1>{store?.name || 'Programa de fidelidade'}</h1></div></div><h2>{token ? 'Crie uma nova senha' : 'Esqueceu sua senha?'}</h2><p>{token ? 'A nova senha deve ter pelo menos 10 caracteres, com letra maiúscula, minúscula e número.' : 'Informe os mesmos dados utilizados no cadastro. Se estiverem corretos, enviaremos um link válido por 30 minutos.'}</p><form onSubmit={submit}>{token ? <><label>Nova senha<input name="password" type="password" autoComplete="new-password" minLength={10} required/></label><label>Confirmar nova senha<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required/></label></> : <><label>CPF<input name="cpf" inputMode="numeric" autoComplete="username" placeholder="000.000.000-00" required/></label><label>E-mail cadastrado<input name="email" type="email" autoComplete="email" required/></label></>}{error&&<div className="error">{error}</div>}{message&&<div className="recovery-success"><Mail/>{message}</div>}<button disabled={busy}>{busy?'Aguarde...':token?'Salvar nova senha':'Enviar link de redefinição'}</button></form><a className="recovery-back" href={`/cliente/${encodeURIComponent(slug)}`}><ArrowLeft/> Voltar para o login</a><small className="recovery-safe"><ShieldCheck/> Por segurança, não informamos se uma conta foi localizada.</small><LegalFooter compact/></section></main>;
}
