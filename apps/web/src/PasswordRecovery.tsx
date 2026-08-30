import { useEffect,useState } from 'react';
import { Mail,MessageCircle } from 'lucide-react';
import { api } from './api';
import './recovery.css';

type Channel='email'|'whatsapp';
const PasswordFields=()=> <><label>Nova senha<input name="password" type="password" minLength={10} autoComplete="new-password" required/></label><label>Confirmar senha<input name="confirmPassword" type="password" minLength={10} autoComplete="new-password" required/></label></>;

export function PasswordRecovery(){
  const token=new URLSearchParams(location.search).get('token');
  const[channel,setChannel]=useState<Channel>('email'),[whatsapp,setWhatsapp]=useState(false),[codeStage,setCodeStage]=useState(false),[saved,setSaved]=useState({email:'',phone:''}),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{api<{channels:string[]}>('/auth/recovery-channels').then(r=>setWhatsapp(r.channels.includes('whatsapp'))).catch(()=>setWhatsapp(false))},[]);
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');setBusy(true);
    try{
      const values=Object.fromEntries(new FormData(event.currentTarget));
      if(token){if(values.password!==values.confirmPassword)throw new Error('As senhas não coincidem.');await api('/auth/reset-password',{method:'POST',body:JSON.stringify({token,password:values.password})});setMessage('Senha redefinida. Você já pode entrar.');}
      else if(codeStage){if(values.password!==values.confirmPassword)throw new Error('As senhas não coincidem.');await api('/auth/reset-password-code',{method:'POST',body:JSON.stringify({...saved,code:values.code,password:values.password})});setMessage('Senha redefinida com segurança. Você já pode entrar.');setCodeStage(false);}
      else{const email=String(values.email),phone=String(values.phone||'');const result=await api<{message:string;developmentToken?:string}>('/auth/forgot-password',{method:'POST',body:JSON.stringify({email,channel,phone:channel==='whatsapp'?phone:undefined,consentWhatsApp:channel==='whatsapp'?values.consentWhatsApp==='on':undefined})});setSaved({email,phone});if(channel==='whatsapp')setCodeStage(true);setMessage(result.developmentToken?`${result.message} Código local: ${result.developmentToken}`:result.message);}
    }catch(reason){setError((reason as Error).message);}finally{setBusy(false)}
  }
  const title=token?'Criar nova senha':codeStage?'Validar código':'Recuperar acesso';
  return <main className="login"><section className="login-card"><a className="recovery-brand" href="/login">F+ Fidelizei</a><h1>{title}</h1><p>{token?'Escolha uma senha forte para proteger sua conta.':codeStage?'Digite o código de seis dígitos enviado ao WhatsApp. Ele é válido por 10 minutos.':whatsapp?'Escolha como deseja receber a recuperação da sua conta.':'Informe seu e-mail e enviaremos um link válido por 30 minutos.'}</p><form onSubmit={submit}>{token?<PasswordFields/>:codeStage?<><label>Código recebido<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" required/></label><PasswordFields/></>:<><label>E-mail de acesso<input name="email" type="email" autoComplete="email" required/></label>{whatsapp&&<div className="user-recovery-channels"><button type="button" className={channel==='email'?'active':''} onClick={()=>{setChannel('email');setMessage('')}}><Mail/> E-mail</button><button type="button" className={channel==='whatsapp'?'active':''} onClick={()=>{setChannel('whatsapp');setMessage('')}}><MessageCircle/> WhatsApp</button></div>}{channel==='whatsapp'&&<><label>Celular cadastrado<input name="phone" inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" required/></label><label className="user-recovery-consent"><input name="consentWhatsApp" type="checkbox" required/><span>Autorizo o envio do código de segurança pelo WhatsApp.</span></label></>}</>}{error&&<div className="error">{error}</div>}{message&&<div className="campaign-feedback">{message}</div>}<button disabled={busy}>{busy?'Aguarde...':token?'Redefinir senha':codeStage?'Validar código e redefinir':channel==='whatsapp'?'Enviar código pelo WhatsApp':'Enviar instruções por e-mail'}</button></form>{codeStage&&<button className="recovery-change" type="button" onClick={()=>{setCodeStage(false);setMessage('');setError('')}}>Corrigir os dados ou trocar o canal</button>}<a className="recovery-link" href="/login">Voltar para o login</a></section><aside><h2>Seu acesso seguro,<br/>sem interromper a operação.</h2></aside></main>;
}
