export function normalizeCpf(value:string){return value.replace(/\D/g,'');}
export function validCpf(value:string){
  const cpf=normalizeCpf(value);
  if(cpf.length!==11||/^(\d)\1{10}$/.test(cpf))return false;
  const digit=(size:number)=>{let sum=0;for(let i=0;i<size;i++)sum+=Number(cpf[i])*(size+1-i);const rest=(sum*10)%11;return rest===10?0:rest;};
  return digit(9)===Number(cpf[9])&&digit(10)===Number(cpf[10]);
}
