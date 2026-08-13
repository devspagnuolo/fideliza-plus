# Aceite do MVP Fideliza+

## Escopo concluído

- autenticação e sessão segura;
- empresa multi-tenant, unidades, usuários e papéis;
- cadastro e importação idempotente de clientes e vendas;
- CRM e segmentação por atividade, frequência e valor;
- pontos por compra, saldo, extrato e resgate auditável;
- dashboard e recomendações iniciais do GIE;
- campanhas segmentadas em rascunho;
- consentimento, exportação e anonimização LGPD;
- rate limiting, proteção de origem, auditoria e backup local;
- interface responsiva para desktop e celular.

## Evidências de validação

- build de produção da API e web aprovado;
- testes unitários de senha e CSV aprovados;
- testes HTTP com duas empresas comprovam isolamento de leitura e escrita;
- resgate comprova atualização transacional de saldo, extrato e auditoria;
- mutação sem cabeçalho de origem é rejeitada;
- migração e seed são repetíveis;
- autenticação e dashboard da Vivi Moda passaram em smoke test.

## Fora do MVP, sem bloquear o piloto

- sincronização Bling;
- disparo por WhatsApp, e-mail ou SMS;
- aplicativos nativos Android/iOS;
- infraestrutura PostgreSQL gerenciada e observabilidade em produção;
- experimentos avançados e atribuição causal do GIE.

Esses itens são evolução do produto. Não devem ser classificados como defeitos ou pendências do MVP web piloto.
