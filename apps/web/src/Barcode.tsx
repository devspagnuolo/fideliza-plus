import{useEffect,useRef}from'react';
import JsBarcode from'jsbarcode';

type BarcodeProps={value:string;label?:string;compact?:boolean;className?:string};

export function Barcode({value,label,compact=false,className=''}:BarcodeProps){
 const ref=useRef<SVGSVGElement>(null),content=String(value||'').trim();
 useEffect(()=>{if(!ref.current||!content)return;JsBarcode(ref.current,content,{format:'CODE128',displayValue:false,lineColor:'#071f42',background:'transparent',width:compact?1.45:2,height:compact?42:72,margin:0})},[content,compact]);
 if(!content)return null;
 return <figure className={`fideliza-barcode ${compact?'compact':''} ${className}`.trim()} aria-label={`Código de barras: ${label||content}`}><svg ref={ref} role="img"/><figcaption>{label||content}</figcaption></figure>
}
