# Backlog técnico

## P0 — piloto utilizável (concluído)

- saldo, extrato e resgate transacional de pontos;
- importação CSV validada, idempotente e com relatório de erros;
- empresa, unidades e usuários com autorização por papel;
- segmentação CRM por recência, frequência, valor e inatividade;
- campanhas segmentadas em rascunho, sem disparo externo;
- testes HTTP e isolamento entre duas empresas;
- backup local, rate limiting, proteção CSRF e auditoria;
- consentimento, exportação e anonimização LGPD.

## P1 — validação comercial

- expiração, estorno e ajuste administrativo de pontos (concluído);
- regras de fidelidade configuráveis por empresa e campanhas de pontos extras (concluído);
- onboarding guiado e indicadores de ativação (concluído);
- recomendações GIE com explicação, prioridade e mensuração de resultado (concluído);
- integração de WhatsApp/e-mail via provedores selecionados;
- jobs assíncronos para importações e recomendações;
- observabilidade, alertas e painel administrativo.

### Regra de transição dos pontos

Créditos novos recebem validade configurável por empresa e podem ser expirados de forma idempotente. Saldos legados importados sem extrato de origem não expiram automaticamente: devem ser conciliados por um ajuste administrativo antes da ativação da validade, preservando a rastreabilidade e evitando baixa indevida.

## P2 — expansão

- integração Bling com OAuth, webhooks, sincronização incremental e reconciliação;
- API pública versionada e gestão de chaves;
- PWA e, após validação, app Android/iOS;
- programa de recompensas e catálogo de benefícios;
- experimentação de campanhas e atribuição de receita;
- avaliar separação de módulos somente a partir de métricas reais de escala.

## Critérios para saída do piloto

- nenhuma leitura ou escrita cruza empresas em testes automatizados;
- importações são idempotentes e conciliáveis;
- backup e restauração testados;
- trilha de auditoria para dados e pontos;
- métricas de ativação, retenção e receita atribuída disponíveis;
- termos, política de privacidade e processos LGPD aprovados.
