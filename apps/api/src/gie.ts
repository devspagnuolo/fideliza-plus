import { randomUUID } from 'node:crypto';
import { db } from './database/db.js';

type Candidate={key:string;title:string;description:string;explanation:string;priority:number;metricName:string;baseline:number;current:number};

export function refreshRecommendations(tenantId:string) {
  const stats=db.prepare(`SELECT
    (SELECT COUNT(*) FROM customers WHERE tenant_id=?) customers,
    (SELECT COUNT(*) FROM customers c WHERE c.tenant_id=? AND NOT EXISTS(SELECT 1 FROM sales s WHERE s.customer_id=c.id AND s.reversed_at IS NULL AND s.occurred_at>=datetime('now','-45 days'))) inactive,
    (SELECT COUNT(*) FROM sales WHERE tenant_id=? AND reversed_at IS NULL AND occurred_at>=datetime('now','-30 days')) sales,
    (SELECT COUNT(*) FROM sales WHERE tenant_id=? AND customer_id IS NOT NULL AND reversed_at IS NULL AND occurred_at>=datetime('now','-30 days')) identifiedSales`).get(tenantId,tenantId,tenantId,tenantId) as {customers:number;inactive:number;sales:number;identifiedSales:number};
  const identificationRate=stats.sales?Math.round(stats.identifiedSales/stats.sales*100):0;
  const candidates:Candidate[]=[];
  if(stats.inactive)candidates.push({key:'reactivate-inactive',title:'Reative clientes inativos',description:`${stats.inactive} clientes estão sem comprar há 45 dias.`,explanation:'Clientes que já compraram tendem a responder melhor que contatos sem histórico. Uma oferta de retorno pode recuperar receita com baixo custo.',priority:Math.min(100,70+stats.inactive),metricName:'clientes_inativos',baseline:stats.inactive,current:stats.inactive});
  if(stats.customers<20)candidates.push({key:'grow-identified-base',title:'Amplie sua base identificada',description:`A base possui ${stats.customers} clientes identificados.`,explanation:'Identificar clientes no caixa permite medir recorrência, atribuir pontos e criar campanhas segmentadas.',priority:Math.max(40,70-stats.customers),metricName:'clientes_identificados',baseline:stats.customers,current:stats.customers});
  if(stats.sales&&identificationRate<70)candidates.push({key:'increase-identification-rate',title:'Identifique mais vendas',description:`${identificationRate}% das vendas recentes estão ligadas a clientes.`,explanation:'Vendas identificadas alimentam o CRM e aumentam a precisão das recomendações e campanhas.',priority:80-identificationRate,metricName:'taxa_identificacao',baseline:identificationRate,current:identificationRate});
  const upsert=db.prepare(`INSERT INTO gie_recommendations (id,tenant_id,recommendation_key,title,description,explanation,priority,metric_name,baseline_value,current_value)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,recommendation_key) DO UPDATE SET title=excluded.title,description=excluded.description,explanation=excluded.explanation,priority=excluded.priority,current_value=excluded.current_value,updated_at=CURRENT_TIMESTAMP`);
  db.transaction(()=>candidates.forEach(item=>upsert.run(randomUUID(),tenantId,item.key,item.title,item.description,item.explanation,item.priority,item.metricName,item.baseline,item.current)))();
  return db.prepare(`SELECT id,recommendation_key key,title,description,explanation,priority,CASE WHEN priority>=75 THEN 'Alto' WHEN priority>=50 THEN 'Médio' ELSE 'Baixo' END impact,metric_name metricName,baseline_value baselineValue,current_value currentValue,status,
    CASE WHEN baseline_value=0 THEN 0 ELSE ROUND((current_value-baseline_value)*100.0/ABS(baseline_value),1) END changePercent
    FROM gie_recommendations WHERE tenant_id=? AND status!='dismissed' ORDER BY priority DESC,created_at`).all(tenantId);
}
