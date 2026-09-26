# Evolucao apos auditoria tecnica

Este documento registra as decisoes aplicadas a partir da auditoria de 26/09/2026. Ele nao substitui evidencias de teste, runbooks ou uma avaliacao juridica/LGPD.

## Entregue nesta rodada

- O ledger de fidelidade passa a ser a fonte contabil do saldo. `customers.points_balance` e tratado como cache e reconciliado automaticamente uma vez ao dia.
- Divergencias corrigidas geram incidente rastreavel e podem ser consultadas/corrigidas manualmente pela API administrativa.
- O bloqueio de tentativas de login passou de `Map` em memoria para eventos persistidos no banco, preservando a protecao depois de restart/deploy.
- O bootstrap do administrador por variavel de ambiente fica desativado em producao. So pode ser reaberto de forma explicita com `PLATFORM_ADMIN_BOOTSTRAP_ENABLED=true` para uma operacao controlada.
- Resgates de recompensa possuem limite diario configuravel por consumidor (`security.daily_redemption_limit`, padrao 10).
- Asaas e autenticacao OAuth do Bling usam circuit breaker para conter falhas repetidas do provedor.
- A aplicacao agora possui um entrypoint de worker dedicado (`npm run start:worker -w @fideliza/api`). Enquanto o banco for SQLite no disco unico do Render, producao permanece em modo `embedded`.

## Migracao SQLite para PostgreSQL

A troca do motor exige migracao controlada; nao deve ser feita diretamente no banco do piloto.

1. Criar PostgreSQL gerenciado com backup e point-in-time recovery.
2. Introduzir uma camada de acesso a dados compativel com SQLite e PostgreSQL.
3. Converter funcoes especificas do SQLite (`datetime`, `date`, `INSERT OR IGNORE`, `randomblob`, comparacoes booleanas).
4. Executar carga inicial em ambiente de homologacao e reconciliar contagens, valores financeiros e `SUM(loyalty_ledger.points)` por consumidor.
5. Rodar testes de isolamento multi-tenant, cobranca, webhooks e concorrencia.
6. Fazer ensaio de cutover e rollback com medicao de RPO/RTO.
7. Parar escritas por janela curta, copiar delta final, reconciliar, alternar a conexao e observar.
8. So depois extrair o worker para outro servico e habilitar mais de uma instancia da API.

## Condicoes para escala horizontal

- PostgreSQL ativo como fonte primaria.
- Worker em servico separado com `WORKER_EXECUTION_MODE=dedicated` na API e `start:worker` no worker.
- Rate limiting em armazenamento compartilhado de baixa latencia (Redis e a recomendacao quando houver multiplas instancias e alto volume).
- Backups fora da regiao/provedor principal testados por restauracao.
- SLOs, alertas e runbooks aprovados para API, fila, cobranca e integracoes.
