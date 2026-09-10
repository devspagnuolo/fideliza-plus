import{useEffect,useState}from'react';
import{ArrowLeft,FileCheck2,Printer,ShieldCheck}from'lucide-react';
import{api}from'./api';
import{BrandLogo}from'./BrandLogo';
import{LegalFooter}from'./LegalPages';
import'./legal.css';
import'./software-contract.css';

type Contract={title:string;version:string;effectiveDate:string;hash:string;sections:{title:string;paragraphs:string[]}[]};

export function SoftwareLicenseContract(){
 const[contract,setContract]=useState<Contract>(),[error,setError]=useState('');
 useEffect(()=>{api<Contract>('/public/software-license-contract').then(setContract).catch(reason=>setError((reason as Error).message))},[]);
 if(!contract)return <main className="legal-page contract-loading"><header><a href="/planos"><ArrowLeft/> Voltar aos planos</a><BrandLogo full/></header><article>{error?<p>{error}</p>:<p>Carregando contrato vigente...</p>}</article></main>;
 return <main className="legal-page software-contract"><header><a href="/planos"><ArrowLeft/> Voltar aos planos</a><BrandLogo full/><button type="button" onClick={()=>window.print()}><Printer/> Imprimir ou salvar PDF</button></header><article><div className="legal-title"><span><FileCheck2/></span><div><small>CONTRATO DE ASSINATURA</small><h1>{contract.title}</h1><p>Este é o instrumento vigente para contratação e uso empresarial da Plataforma Fidelizei.</p><em>Versão {contract.version} · Vigente desde {new Date(`${contract.effectiveDate}T12:00:00`).toLocaleDateString('pt-BR')}</em></div></div><div className="contract-summary"><ShieldCheck/><p>Ao concluir a assinatura, o responsável confirma eletronicamente a leitura e o aceite deste contrato, incluindo cobrança recorrente, fidelidade mínima de 6 meses e regras de cancelamento. A Fidelizei registra a versão, a integridade do texto e as evidências técnicas do aceite.</p></div>{contract.sections.map(section=><section key={section.title}><h2>{section.title}</h2>{section.paragraphs.map((paragraph,index)=><p key={index}>{paragraph}</p>)}</section>)}<footer className="contract-integrity"><b>Identificação da versão aceita</b><span>Versão {contract.version}</span><code>SHA-256 {contract.hash}</code></footer></article><LegalFooter/></main>;
}
