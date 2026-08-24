import { useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, Mail, MessageCircle, ShieldCheck } from 'lucide-react';
import { api } from './api';
import { BrandLogo } from './BrandLogo';
import { LegalFooter } from './LegalPages';
import './recovery.css';
import './whatsapp-recovery.css';

type Channel = 'email' | 'whatsapp';

export function CustomerPasswordRecovery({ slug }: { slug: string }) {
  const token = new URLSearchParams(location.search).get('token');
  const [store, setStore] = useState<{ name: string; recoveryChannels?: Channel[] }>();
  const [channel, setChannel] = useState<Channel>('email');
  const [codeStage, setCodeStage] = useState(false);
  const [savedCpf, setSavedCpf] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ name: string; recoveryChannels?: Channel[] }>(`/customer/store/${encodeURIComponent(slug)}`).then(setStore).catch(() => undefined); }, [slug]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      if (token) {
        const password=String(values.password||'').normalize('NFKC').trim(),confirmation=String(values.confirmPassword||'').normalize('NFKC').trim();
        if (password !== confirmation) throw new Error('As senhas não coincidem.');
        await api('/customer/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
        setMessage('Senha redefinida. Abrindo seu programa com segurança…');
        setTimeout(()=>location.replace(`/cliente/${encodeURIComponent(slug)}`),700);
      } else if (codeStage) {
        const password=String(values.password||'').normalize('NFKC').trim(),confirmation=String(values.confirmPassword||'').normalize('NFKC').trim();
        if (password !== confirmation) throw new Error('As senhas não coincidem.');
        await api('/customer/auth/reset-password-code', { method: 'POST', body: JSON.stringify({ tenantSlug: slug, cpf: savedCpf, code: values.code, password }) });
        setMessage('Senha redefinida. Abrindo seu programa com segurança…');
        setTimeout(()=>location.replace(`/cliente/${encodeURIComponent(slug)}`),700);
      } else {
        const result = await api<{ message: string; channel: Channel }>('/customer/auth/forgot-password', {
          method: 'POST', body: JSON.stringify({
            tenantSlug: slug, cpf: values.cpf, channel,
            email: channel === 'email' ? values.email : undefined,
            phone: channel === 'whatsapp' ? values.phone : undefined,
            consentWhatsApp: channel === 'whatsapp' ? values.consentWhatsApp === 'on' : undefined,
          }),
        });
        setMessage(result.message);
        if (channel === 'whatsapp') { setSavedCpf(String(values.cpf)); setCodeStage(true); }
      }
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  const resetMode = Boolean(token || codeStage);
  const whatsappAvailable=store?.recoveryChannels?.includes('whatsapp')===true;
  return <main className="customer-recovery"><section><BrandLogo full/><div className="recovery-store"><span><KeyRound/></span><div><small>RECUPERAÇÃO SEGURA</small><h1>{store?.name || 'Programa de fidelidade'}</h1></div></div><h2>{resetMode ? 'Crie uma nova senha' : 'Esqueceu sua senha?'}</h2><p>{token ? 'Abra o link recebido por e-mail e defina sua nova senha.' : codeStage ? 'Digite o código de seis dígitos recebido no WhatsApp. Ele é válido por 10 minutos.' : whatsappAvailable?'Escolha como deseja receber as instruções de recuperação.':'Receba um link seguro no e-mail informado no cadastro.'}</p><form onSubmit={submit}>{token ? <PasswordFields/> : codeStage ? <><label>Código recebido<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" required/></label><PasswordFields/></> : <><label>CPF<input name="cpf" inputMode="numeric" autoComplete="username" placeholder="000.000.000-00" required/></label>{whatsappAvailable&&<div className="recovery-channels"><button type="button" className={channel==='email'?'active':''} onClick={()=>{setChannel('email');setMessage('')}}><Mail/> E-mail</button><button type="button" className={channel==='whatsapp'?'active':''} onClick={()=>{setChannel('whatsapp');setMessage('')}}><MessageCircle/> WhatsApp</button></div>}{channel==='email'?<label>E-mail cadastrado<input name="email" type="email" autoComplete="email" required/></label>:<><label>Celular com WhatsApp<input name="phone" inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" required/></label><label className="recovery-consent"><input name="consentWhatsApp" type="checkbox" required/><span>Autorizo o envio deste código de segurança pelo WhatsApp.</span></label></>}</>}{error&&<div className="error">{error}</div>}{message&&<div className="recovery-success">{channel==='whatsapp'?<MessageCircle/>:<Mail/>}{message}</div>}<button disabled={busy}>{busy?'Aguarde...':token?'Salvar nova senha':codeStage?'Validar código e salvar senha':channel==='whatsapp'?'Enviar código pelo WhatsApp':'Enviar link por e-mail'}</button></form>{codeStage&&<button className="recovery-change" type="button" onClick={()=>{setCodeStage(false);setMessage('');setError('')}}>Usar outro canal ou corrigir os dados</button>}<a className="recovery-back" href={`/cliente/${encodeURIComponent(slug)}`}><ArrowLeft/> Voltar para o login</a><small className="recovery-safe"><ShieldCheck/> Por segurança, não informamos se uma conta foi localizada.</small><LegalFooter compact/></section></main>;
}

function PasswordFields(){return <><label>Nova senha<input name="password" type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} minLength={10} required/><small>Use no mínimo 10 caracteres, com letra maiúscula, minúscula e número.</small></label><label>Confirmar nova senha<input name="confirmPassword" type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} minLength={10} required/></label></>}
