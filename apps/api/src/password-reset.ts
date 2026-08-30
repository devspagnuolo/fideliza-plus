import { randomInt,randomUUID } from 'node:crypto';import { db } from './database/db.js';import { config } from './config.js';import { hashPassword,hashToken,newToken } from './security.js';
async function sendResetEmail(email:string,token:string){if(!process.env.RESEND_API_KEY)return;const url=`${config.webOrigins[0]||'https://fidelizaplus.com.br'}/reset-password?token=${encodeURIComponent(token)}`,response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${process.env.RESEND_API_KEY}`,'content-type':'application/json','idempotency-key':hashToken(token)},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[email],subject:'Redefinição de senha · Fidelizei',text:`Use este link em até 30 minutos para redefinir sua senha: ${url}`})});if(!response.ok)throw new Error(`Resend HTTP ${response.status}`);}
export async function requestPasswordReset(email:string){const user=db.prepare('SELECT id,email FROM users WHERE lower(email)=lower(?) AND active=1').get(email) as {id:string;email:string}|undefined;if(!user)return;db.prepare("UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND used_at IS NULL").run(user.id);const token=newToken(),expiresAt=new Date(Date.now()+30*60_000).toISOString();db.prepare('INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').run(randomUUID(),user.id,hashToken(token),expiresAt);try{await sendResetEmail(user.email,token);}catch(error){console.error('Falha ao enviar recuperação de senha',error);}return config.isProduction?undefined:token;}
export function resetPassword(token:string,password:string){const row=db.prepare("SELECT id,user_id FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>datetime('now')").get(hashToken(token)) as {id:string;user_id:string}|undefined;if(!row)return false;db.transaction(()=>{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password),row.user_id);db.prepare('UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=?').run(row.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);})();return true;}

function normalizePhone(value:string){const digits=value.replace(/\D/g,'');return digits.startsWith('55')&&digits.length>=12?digits.slice(2):digits;}
export function whatsappRecoveryAvailable(){return Boolean(process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID&&process.env.WHATSAPP_PASSWORD_RESET_TEMPLATE);}
export function requestPasswordResetWhatsApp(email:string,providedPhone:string){
  if(!whatsappRecoveryAvailable())return;
  const user=db.prepare('SELECT id,tenant_id,phone FROM users WHERE lower(email)=lower(?) AND active=1').get(email)as{id:string;tenant_id:string;phone:string|null}|undefined;
  if(!user||!user.phone||normalizePhone(user.phone)!==normalizePhone(providedPhone))return;
  db.prepare("UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND used_at IS NULL").run(user.id);
  const code=String(randomInt(100000,1000000)),expiresAt=new Date(Date.now()+10*60_000).toISOString();
  db.transaction(()=>{
    db.prepare("INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at,delivery_channel,attempts)VALUES(?,?,?,?, 'whatsapp',0)").run(randomUUID(),user.id,hashToken(code),expiresAt);
    db.prepare("INSERT INTO outbound_messages(id,tenant_id,recipient,channel,template,subject,message,scheduled_at)VALUES(?,?,?,'whatsapp','user.password_reset_otp','Código de segurança',?,CURRENT_TIMESTAMP)").run(randomUUID(),user.tenant_id,user.phone,code);
  })();
  return config.isProduction?undefined:code;
}
export function resetPasswordWithCode(email:string,providedPhone:string,code:string,password:string){
  const user=db.prepare('SELECT id,phone FROM users WHERE lower(email)=lower(?) AND active=1').get(email)as{id:string;phone:string|null}|undefined;
  if(!user||!user.phone||normalizePhone(user.phone)!==normalizePhone(providedPhone))return false;
  const row=db.prepare("SELECT id,user_id FROM password_reset_tokens WHERE user_id=? AND token_hash=? AND delivery_channel='whatsapp' AND used_at IS NULL AND expires_at>datetime('now') AND attempts<5 ORDER BY created_at DESC LIMIT 1").get(user.id,hashToken(code))as{id:string;user_id:string}|undefined;
  if(!row){db.prepare("UPDATE password_reset_tokens SET attempts=attempts+1 WHERE id=(SELECT id FROM password_reset_tokens WHERE user_id=? AND delivery_channel='whatsapp' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1)").run(user.id);return false;}
  db.transaction(()=>{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password),row.user_id);db.prepare('UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=?').run(row.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);})();return true;
}
