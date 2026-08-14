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
- integração de WhatsApp/e-mail via provedores selecionados (Resend e Meta implementados; ativação depende de credenciais e templates aprovados);
- jobs assíncronos para importações, campanhas e recomendações (concluído para o piloto);
- observabilidade, alertas e painel administrativo (concluído para o piloto; monitor externo pendente para produção).
- recuperação de senha com token de uso único (concluído);
- autenticação em dois fatores TOTP para usuários (concluído);
- worker automático para jobs, campanhas e expiração (concluído no monólito; separação opcional em produção).

### Regra de transição dos pontos

Créditos novos recebem validade configurável por empresa e podem ser expirados de forma idempotente. Saldos legados importados sem extrato de origem não expiram automaticamente: devem ser conciliados por um ajuste administrativo antes da ativação da validade, preservando a rastreabilidade e evitando baixa indevida.

## P2 — expansão

- integração Bling: OAuth, renovação de tokens, sincronização incremental idempotente, webhooks autenticados e painel de reconciliação concluídos;
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
