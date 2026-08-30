import { Check, Circle, Rocket } from 'lucide-react';

type Activation = { progress:number; activated:boolean; steps:{id:string;title:string;description:string;complete:boolean}[] };

export function OnboardingChecklist({activation}:{activation:Activation}) {
  if(activation.activated)return <section className="panel activation-complete"><Rocket/><div><h2>Empresa ativada</h2><p>Os passos essenciais do piloto foram concluídos.</p></div><strong>100%</strong></section>;
  return <section className="panel onboarding"><div className="panel-title"><div className="ai"><Rocket/></div><div><h2>Primeiros passos</h2><p>Complete a configuração para colocar o Fidelizei em operação.</p></div><strong className="progress-value">{activation.progress}%</strong></div><div className="progress"><span style={{width:`${activation.progress}%`}}/></div><div className="onboarding-steps">{activation.steps.map(step=><article className={step.complete?'complete':''} key={step.id}>{step.complete?<Check/>:<Circle/>}<div><b>{step.title}</b><small>{step.description}</small></div></article>)}</div></section>;
}
