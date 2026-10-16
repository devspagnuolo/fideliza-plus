# Integração StoreOS ↔ Fidelizei ↔ Bling

## Responsabilidades

- **Fidelizei** é a autoridade do programa: adesão, vínculo de identidades, saldo, regras, elegibilidade, códigos e estornos dos resgates.
- **StoreOS** autentica o consumidor e conduz a experiência da loja/checkout. Seu identificador de cliente e o identificador do checkout são referências de correlação, não substituem o CPF nem o pedido Bling.
- **Bling** é a fonte oficial dos pedidos que geram pontos. O StoreOS nunca deve enviar uma venda diretamente como venda Fidelizei. O crédito ocorre quando o pedido aparece conciliado no Fidelizei como venda de origem Bling, identificado para a mesma cliente e não estornado.

O StoreOS documenta o fluxo de checkout como validar o cupom e então criar o pedido. Para esta integração, a chave Fidelizei fica apenas no backend/conector servidor-a-servidor; nunca exponha fz_live_... no app ou navegador StoreOS.

## Pré-requisitos

1. Bling conectado à empresa Fidelizei e sincronizando contatos, pedidos, alterações e cancelamentos.
2. Plano ativo/de teste que inclua integração ERP.
3. No portal da empresa, criar uma chave em **Integrações → Chaves da API → Nova chave → StoreOS**.
4. Guardar a chave em secret manager/backend. As permissões são: customers:enroll, rewards:read, rewards:redeem, rewards:validate, rewards:cancel e events:read.
5. Capturar no StoreOS consentimento afirmativo do consumidor para adesão, registrar versão dos Termos e da Política de Privacidade e só então chamar o endpoint de adesão. O Fidelizei registra origem, versões, IP e User-Agent recebidos.
6. O backend StoreOS deve usar uma chave de idempotência estável por operação. Não reutilize uma chave com corpo diferente.

Base: https://api.fidelizaplus.com.br/public/v1

Envie os cabeçalhos em todas as chamadas:

    Authorization: Bearer fz_live_SUA_CHAVE
    Content-Type: application/json
    Idempotency-Key: storeos-enroll-CLIENTE-123-v1

Envie sempre via HTTPS. CPF é dado pessoal: minimize a exposição, não o inclua em logs, URLs ou eventos. Nunca registre o cabeçalho Authorization.

## 1. Adesão e vínculo

POST /storeos/customers/enroll (escopo customers:enroll)

    {
      "externalCustomerId": "customer_123",
      "name": "Nome da cliente",
      "cpf": "52998224725",
      "email": "cliente@example.com",
      "phone": "11999998888",
      "programConsent": true,
      "termsVersion": "2026-10",
      "privacyVersion": "2026-10"
    }

- O CPF normalizado é a identidade de fidelidade; externalCustomerId cria um vínculo estável StoreOS↔Fidelizei, isolado por empresa.
- Se o CPF já estiver no Fidelizei, o cadastro é associado ao registro existente e o saldo/histórico não é recriado.
- Cadastro novo ou consumidor ainda não aderente exige programConsent: true, versão dos documentos, nome e CPF válido.
- programConsent: false pode apenas vincular um cadastro que já tenha adesão. Não habilita fidelidade nem registra consentimento novo.
- Resposta inclui id, pointsBalance, enrolledAt, eligibleForPoints e os pontos eventualmente reprocessados de pedidos Bling do mesmo dia da adesão.
- O StoreOS deve encaminhar/atualizar o contato no Bling usando o mesmo CPF. Isso permite a identificação quando o pedido for conciliado.

O endpoint não cria credencial de login Fidelizei; ele vincula a identidade da conta StoreOS à identidade do programa.

## 2. Consultar saldo, nível e benefícios

GET /storeos/customers/{externalCustomerId}/loyalty (escopo rewards:read)

Retorna saldo atual, data de adesão, nível e recompensas ativas do tipo cupom que o cliente pode visualizar, incluindo validade, custo em pontos e se o saldo permite resgatar. O servidor deve tratar o saldo retornado como retrato do momento: a reserva valida novamente saldo, validade, nível e mínimo do pedido em transação.

## 3. Reservar e resgatar

POST /storeos/redemptions (escopo rewards:redeem; Idempotency-Key obrigatório)

    {
      "externalCustomerId": "customer_123",
      "rewardId": "UUID-ou-id-da-recompensa",
      "checkoutId": "checkout_987",
      "subtotalCents": 25000
    }

Em uma transação, Fidelizei valida a adesão, nível, validade, estoque e saldo; debita os pontos uma única vez; registra o ledger/auditoria; e emite um código único vinculado à cliente e ao checkout. A reserva expira em 20 minutos, ou antes se o cupom vencer. Uma nova tentativa com o mesmo Idempotency-Key e mesmo corpo retorna a resposta original; mesmo identificador com outro corpo retorna 409 IDEMPOTENCY_KEY_REUSED.

O checkout deve aplicar o desconto retornado pela API de validação (não recalcular a regra localmente) e manter a referência redemptionId e checkoutId.

## 4. Validar antes de aplicar o desconto

POST /storeos/coupons/validate (escopo rewards:validate)

    {
      "code": "FZ-ABC123DEF4",
      "externalCustomerId": "customer_123",
      "checkoutId": "checkout_987",
      "subtotalCents": 25000
    }

A validação confirma cliente, reserva, checkout, validade, mínimo e regra de desconto. Só aplique o cupom quando a resposta for HTTP 200 com data.status = valid. Em falhas, não conceda o desconto e não tente consumir pontos localmente.

## 5. Confirmar uso depois da conciliação Bling

POST /storeos/redemptions/{redemptionId}/confirm (escopo rewards:validate; Idempotency-Key obrigatório)

    {
      "checkoutId": "checkout_987",
      "blingOrderId": "123456789",
      "blingOrderNumber": "25781"
    }

Fidelizei só marca o cupom como usado depois que o pedido existe em sales com origem Bling, mesmo cliente, ID e número comercial correspondentes e sem estorno. Se o pedido ainda não chegou pela sincronização/webhook do Bling, a API retorna 409 BLING_ORDER_NOT_CONFIRMED; mantenha a confirmação pendente e tente novamente com backoff, sem repetir o pedido/cupom no checkout. O StoreOS deve preservar a relação entre checkout, pedido emitido pelo Bling e cliente.

## 6. Falha de checkout, expiração e cancelamento

POST /storeos/redemptions/{redemptionId}/cancel (escopo rewards:cancel; Idempotency-Key obrigatório)

Falha/abandono do checkout antes do uso:

    { "checkoutId": "checkout_987", "reason": "checkout_failed" }

Cancelamento do pedido já utilizado:

    { "blingOrderId": "123456789", "reason": "order_cancelled" }

Uma reserva cancelada ou expirada devolve os pontos ao saldo, registra lançamento de estorno, repõe estoque quando limitado e emite evento. Um cupom já utilizado só pode ser estornado depois que o Bling confirmar o estorno/cancelamento daquela venda. A expiração é aplicada automaticamente na próxima chamada à API StoreOS e antes das operações de saldo/resgate; por isso o integrador deve reconciliar periodicamente e também cancelar reservas assim que souber que o checkout falhou.

## 7. Eventos e reconciliação

GET /storeos/events?after=0&limit=100 (escopo events:read)

O endpoint retorna eventos de adesão/vínculo, reserva/uso/cancelamento/expiração e alterações de pontos conciliadas pelo Bling. Persista nextCursor após processar cada página e avance somente depois de confirmar o processamento. Em resposta vazia, mantenha o cursor. Limite máximo: 200.

Eventos são uma fila de consulta da integração, não um webhook de saída. A API garante a leitura incremental por cursor; o consumidor deve deduplicar pelo id, reter o cursor e consultar periodicamente. Para uma operação de grande volume, use o feed como mecanismo de reconciliação além das confirmações de checkout.

## Erros e retentativas

- 401: chave ausente, inválida, expirada ou revogada — não retente sem corrigir segredo.
- 403: escopo/plano não permite — solicite ao proprietário revisão do acesso/plano.
- 409: estado conflitante, saldo, prazo, checkout ou pedido ainda não conciliado — consulte novamente; não repita mutações com novo identificador sem verificar estado.
- 422: consentimento obrigatório ou regra/entrada inválida — corrija o fluxo.
- 429: limite por chave (120 req/min) — backoff exponencial com jitter.
- 5xx: falha temporária — backoff com jitter, mesma Idempotency-Key e mesmo corpo para mutações.

## Limites da homologação

A API Fidelizei está preparada para o contrato acima. A homologação completa exige conectar o backend StoreOS real, mapear seu ID de cliente e correlação de checkout→pedido Bling, validar o comportamento de cancelamento no tenant da Vivi e confirmar o ciclo real de webhook/sincronização do Bling. A documentação pública StoreOS consultada descreve storefront, autenticação de cliente, validação de cupom e criação/cancelamento de pedidos; o fluxo de integração Fidelizei↔Bling deve ser executado no backend/conector do projeto StoreOS, não presumido como recurso nativo.
