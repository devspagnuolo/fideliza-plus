import{useEffect,useRef,useState}from'react';
import{LoaderCircle,MailCheck}from'lucide-react';
import{api}from'./api';

type Turnstile={render:(el:HTMLElement,options:Record<string,unknown>)=>string;reset:(id?:string)=>void;remove:(id:string)=>void};
declare global{interface Window{turnstile?:Turnstile}}
export type CaptchaConfig={provider:'turnstile';siteKey:string}|null|undefined;

let turnstileScript:Promise<Turnstile>|undefined;
function loadTurnstile(){
 turnstileScript??=new Promise<Turnstile>((resolve,reject)=>{
  if(window.turnstile)return resolve(window.turnstile);
  const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
  script.onload=()=>window.turnstile?resolve(window.turnstile):reject(new Error('Turnstile indisponível'));script.onerror=()=>{turnstileScript=undefined;reject(new Error('Turnstile indisponível'))};
  document.head.appendChild(script);
 });
 return turnstileScript;
}

/** Widget do Cloudflare Turnstile; o token vale para um único pedido e é renovado após cada envio. */
function TurnstileWidget({siteKey,onToken,resetKey}:{siteKey:string;onToken:(token:string)=>void;resetKey:number}){
 const box=useRef<HTMLDivElement>(null),widget=useRef<string|undefined>(undefined),[failed,setFailed]=useState(false);
 useEffect(()=>{let active=true;loadTurnstile().then(turnstile=>{if(!active||!box.current)return;widget.current=turnstile.render(box.current,{sitekey:siteKey,language:'pt-br',callback:onToken,'expired-callback':()=>onToken(''),'error-callback':()=>onToken('')})}).catch(()=>setFailed(true));return()=>{active=false;if(widget.current)window.turnstile?.remove(widget.current);widget.current=undefined}},[siteKey]);
 useEffect(()=>{if(resetKey&&widget.current){onToken('');window.turnstile?.reset(widget.current)}},[resetKey]);
 return <div className="trial-captcha">{failed?<small className="gateway-warning">Não foi possível carregar a verificação anti-robô. Recarregue a página.</small>:<div ref={box}/>}</div>;
}

export function TrialEmailVerification({email,captcha,code,onCode,onMessage}:{email:string;captcha:CaptchaConfig;code:string;onCode:(code:string)=>void;onMessage:(message:string)=>void}){
 const[token,setToken]=useState(''),[sending,setSending]=useState(false),[sentTo,setSentTo]=useState(''),[resetKey,setResetKey]=useState(0);
 const normalized=email.trim().toLowerCase(),validEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
 useEffect(()=>{if(sentTo&&sentTo!==normalized){setSentTo('');onCode('')}},[normalized]);
 async function send(){
  if(!validEmail){onMessage('Informe o e-mail de acesso antes de pedir o código.');return}
  if(captcha&&!token){onMessage('Conclua a verificação anti-robô para receber o código.');return}
  setSending(true);
  try{const result=await api<{destination:string;expiresInMinutes:number;developmentCode?:string}>('/public/trials/email-code',{method:'POST',body:JSON.stringify({email:normalized,captchaToken:token||undefined})});setSentTo(normalized);onCode(result.developmentCode??'');onMessage(`Enviamos um código para ${result.destination}. Ele vale por ${result.expiresInMinutes} minutos; confira também o spam.`)}
  catch(error){onMessage((error as Error).message)}
  finally{setSending(false);if(captcha)setResetKey(key=>key+1)}
 }
 return <div className="trial-email-verification wide">
  {captcha&&<TurnstileWidget siteKey={captcha.siteKey} onToken={setToken} resetKey={resetKey}/>}
  <div className="trial-email-code">
   <button type="button" className="site-button ghost" onClick={send} disabled={sending||!validEmail||Boolean(captcha&&!token)}>{sending?<LoaderCircle className="spin"/>:<MailCheck/>}{sentTo?'Reenviar código':'Enviar código de confirmação'}</button>
   <label>Código recebido por e-mail<input value={code} onChange={e=>onCode(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" pattern="\d{6}" title="Informe os 6 dígitos enviados por e-mail" required/></label>
  </div>
 </div>;
}
