# Arquitetura multi-ERP do Fidelizei

## Objetivo

Permitir que o Fidelizei receba clientes, vendas, alterações e cancelamentos de diferentes ERPs sem duplicar regras de fidelidade. Um conector só pode aparecer como **Disponível** depois de implementação, homologação funcional e validação operacional.

“Integrar todos os ERPs” é tratado como capacidade extensível, não como promessa de compatibilidade automática. Produtos com contratos diferentes (como linhas Linx e TOTVS) exigem adaptadores separados.

## Núcleo comum

Todo adaptador deve traduzir o provedor para os contratos canônicos do Fidelizei:

- cliente: identificador externo, nome, CPF/CNPJ, e-mail, telefone e data de atualização;
- venda: identificador externo, número, cliente, valor em centavos, situação e datas;
- cancelamento/devolução: atualização idempotente da venda e estorno rastreável dos pontos;
- produto e estoque: opcionais e ativados apenas quando o caso de uso justificar;
- cursor: posição da última leitura incremental;
- vínculo de entidade: relação única entre ID externo e ID local por empresa e provedor.

O contrato TypeScript está em `apps/api/src/erp/types.ts`. O catálogo técnico está em `apps/api/src/erp/catalog.ts`.

## Pipeline obrigatório

1. Autenticar a empresa usando o método oficial do provedor.
2. Guardar segredos somente criptografados no servidor.
3. Testar identidade da conta e escopos antes da primeira carga.
4. Executar carga inicial paginada com limite e retomada.
5. Normalizar e validar dados antes de gravar.
6. Aplicar idempotência por empresa, provedor, entidade e ID externo.
7. Processar webhooks quando disponíveis e manter conciliação periódica.
8. Tratar eventos fora de ordem pela data de atualização externa.
9. Registrar cada execução em `integration_sync_runs`.
10. Nunca conceder pontos duas vezes; cancelamento ou exclusão deve conciliar o ledger.

## Estados publicados

| Estado | Significado operacional |
|---|---|
| Disponível | Adaptador implementado e homologado; aceita conexão real |
| Em desenvolvimento | Contrato e prioridade definidos; ainda não aceita credenciais do cliente |
| Planejado | Viabilidade confirmada, implementação ainda não iniciada/concluída |
| Depende de parceria | Requer liberação comercial ou técnica do fornecedor |
| Por produto/versão | A marca possui contratos diferentes e exige descoberta antes do desenvolvimento |

## Matriz inicial

| ERP | Prioridade | Autenticação | Situação | Fundamentação oficial |
|---|---:|---|---|---|
| Bling | 1 | OAuth 2.0, refresh e JWT | Disponível | https://developer.bling.com.br/ |
| Omie | 1 | App key e app secret | Em desenvolvimento | https://developer.omie.com.br/ |
| Conta Azul | 1 | OAuth 2.0 por empresa | Em desenvolvimento | https://developers.contaazul.com/introduction |
| Olist Tiny | 1 | Credencial da API adotada | Planejado | https://tiny.com.br/api-docs/ |
| vhsys | 2 | Tokens da extensão Integração via API | Planejado | https://developers.vhsys.com.br/ |
| Linx | 3 | Catálogo contratado e produto específico | Depende de parceria | https://share.linx.com.br/ |
| TOTVS | 3 | Produto, versão e ambiente específicos | Por produto/versão | https://tdn.totvs.com/ |

## Critérios de homologação de cada adaptador

- autorização, renovação e revogação testadas;
- isolamento entre duas empresas validado;
- cliente novo, atualizado e incompleto testados;
- venda identificada e não identificada testadas;
- repetição da mesma venda sem duplicidade;
- cancelamento, exclusão, devolução e reativação testados;
- pontos e saldo conciliados com o ledger;
- paginação, limite de API, retentativa e indisponibilidade testados;
- webhook duplicado e fora de ordem testados, quando aplicável;
- painel exibe última execução, erro acionável e necessidade de reconexão;
- documentação de conexão e checklist de homologação publicados.

## Ordem de implementação

### Onda 1 — maior aderência a pequenos e médios varejos

1. Omie.
2. Conta Azul.
3. Olist Tiny.

### Onda 2 — ampliação do mercado PME

1. vhsys.
2. Descoberta comercial/técnica para linhas Linx prioritárias.

### Onda 3 — conectores por produto

1. TOTVS, começando somente pela linha confirmada por um cliente real.
2. Demais ERPs mediante demanda comprovada, documentação oficial e acesso de homologação.

## Segurança e operação

- OAuth `state` deve ser de uso único, curto e vinculado ao usuário e à empresa.
- Tokens, chaves e segredos nunca aparecem em respostas da API, logs ou navegador.
- Webhooks exigem assinatura/autenticidade, idempotência e retenção controlada.
- Mensagens de erro públicas não devem revelar payloads ou credenciais.
- Logs operacionais usam correlação, provedor, empresa, execução e código de erro.
- O administrador visualiza saúde e falhas; o lojista visualiza apenas a própria empresa.

## Próximo incremento executável

O próximo adaptador deve ser o **Omie**. Antes de liberar o botão de conexão, é necessário obter uma aplicação/credenciais de homologação, mapear situações de pedidos e executar todos os critérios acima. Em paralelo, a aplicação OAuth da Conta Azul deve ser cadastrada para viabilizar o segundo adaptador.
