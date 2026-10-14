# API do PDV Fidelizei

Esta documentação conecta o PDV à empresa dona da chave de API. Para a **Vivi Moda Plus Size**, o **Bling é a fonte oficial dos pedidos**. O Fidelizei recebe do PDV apenas dados de identificação/adesão da cliente e validações de benefícios; vendas, valores, números de pedido, situações e cancelamentos são conciliados a partir do Bling.

## Princípio de integração

```text
PDV → cadastra/identifica cliente no Fidelizei
PDV → cria ou atualiza contato e pedido no Bling
Bling → webhook/sincronização → Fidelizei
Fidelizei → vincula pelo CPF → registra pedido Bling → calcula/estorna pontos
```

Nunca envie ao Fidelizei o número interno do PDV como se fosse o pedido oficial. No banco do Fidelizei, pedidos dessa operação usam:

- `source: bling`
- `external_id: bling:<id-do-pedido-no-bling>`
- `order_number: <número-do-pedido-no-bling>`
- valor, data, cliente e situação recebidos do Bling

## URL e autenticação

Base de produção:

```text
https://api.fidelizaplus.com.br/public/v1
```

Envie a chave em todas as requisições:

```http
Authorization: Bearer fz_live_SUA_CHAVE
Content-Type: application/json
```

A empresa é identificada pela chave. Nunca envie `tenantId` pelo caixa e nunca exponha a chave no navegador, aplicativo cliente, recibo ou log.

## Escopos do perfil PDV com Bling

| Escopo | Uso |
|---|---|
| `customers:read` | localizar cliente/cartão pelo CPF |
| `customers:write` | criar ou atualizar a adesão do consumidor |
| `sales:read` | consultar pedidos já conciliados do Bling, se necessário |
| `rewards:validate` | validar e utilizar o benefício apresentado no caixa |

O escopo `sales:write` não deve ser usado pela integração PDV + Bling. Mesmo que uma chave antiga ainda possua esse escopo, o Fidelizei bloqueia criação e estorno direto quando o Bling está conectado.

## Fluxo obrigatório do caixa

1. Abra a venda no PDV.
2. Leia o cartão ou informe o CPF da cliente.
3. Consulte a cliente no Fidelizei.
4. Se ela não existir, cadastre-a após o consentimento e mantenha o mesmo CPF no contato do Bling.
5. Crie ou atualize o contato no Bling com esse CPF.
6. Envie e confirme o pedido no Bling.
7. Use sempre o ID e o número retornados pelo Bling para comprovantes, cupons e conferência.
8. Aguarde o webhook ou a sincronização do Fidelizei. O pedido será vinculado à cliente pelo contato/CPF.
9. Cancelamentos, exclusões e alterações de valor devem ser feitos no Bling; o Fidelizei reconciliará os pontos automaticamente. Para vincular o pedido, o contato no Bling precisa ter o mesmo CPF válido cadastrado no Fidelizei. A ausência de telefone no contato do Bling não impede o vínculo de uma cliente já cadastrada; para importar um contato novo, nome, CPF válido e telefone são necessários.

## Localizar cliente

```http
GET /customers/lookup?cpf=52998224725
```

Resposta `200`:

```json
{
  "data": {
    "id": "uuid",
    "name": "Eloah Ferreira",
    "cpf": "52998224725",
    "pointsBalance": 340,
    "enrolledAt": "2026-10-08T12:00:00.000Z",
    "eligibleForPoints": true
  }
}
```

`404` significa que o CPF não participa do programa daquela loja.

## Cadastrar ou atualizar cliente

```http
POST /customers/upsert
```

```json
{
  "name": "Eloah Ferreira",
  "cpf": "52998224725",
  "phone": "11999998888",
  "email": "eloah@exemplo.com",
  "programConsent": true
}
```

`programConsent: true` só deve ser enviado após aceite explícito. Nome, CPF, celular e e-mail são obrigatórios para a adesão pelo PDV.

No primeiro cadastro consentido, o Fidelizei:

- registra o consentimento com origem `pdv`;
- cria a conta da cliente;
- gera uma senha temporária válida por 48 horas;
- coloca o e-mail de boas-vindas na fila de envio.

A senha nunca é devolvida pela API nem armazenada em texto puro.

## Pedido oficial e pontuação do mesmo dia

O PDV **não deve chamar `POST /sales`** para a Vivi Moda Plus Size. Ao detectar o Bling conectado, o Fidelizei responde:

```json
{
  "error": "O Bling é a fonte oficial dos pedidos desta empresa. Registre ou cancele a venda no Bling; o Fidelizei fará a conciliação automática.",
  "code": "BLING_ORDER_SOURCE_REQUIRED",
  "provider": "bling",
  "acceptedExternalIdPrefix": "bling:"
}
```

A adesão vale para todo o dia comercial no fuso de São Paulo. Se o pedido do Bling tiver sido aberto antes do cadastro, mas pedido e adesão ocorrerem no mesmo dia, ele recebe pontos normalmente depois que o contato do Bling for identificado pelo mesmo CPF.

Pedidos de dias anteriores não recebem crédito retroativo. Reenvios, webhooks repetidos e sincronizações manuais não duplicam pontos porque a conciliação usa o ID imutável do pedido do Bling e o ledger de fidelidade.

## Cancelamentos e alterações

Não use o endpoint de estorno do PDV quando o Bling estiver conectado.

- Cancele ou exclua o pedido no Bling.
- Corrija valor, cliente ou situação no Bling.
- O webhook ou a próxima sincronização atualizará o pedido no Fidelizei.
- O Fidelizei estornará, complementará ou reativará somente a diferença necessária.

## Consumir cupom no caixa

Depois de obter o número oficial do pedido no Bling:

```http
POST /redemptions/consume
```

```json
{
  "code": "FZ-AB12CD34",
  "orderNumber": "400"
}
```

`orderNumber` deve ser o número do pedido no Bling. O consumo é atômico e de uso único.

## Tratamento obrigatório de respostas

| Código | Ação do PDV |
|---:|---|
| 200/201 | confirmar a operação localmente |
| 400 | corrigir os dados; não repetir automaticamente |
| 401 | chave ausente, inválida, vencida ou revogada |
| 403 | escopo ou plano não liberado |
| 404 | cliente ou cupom não pertence à loja/não existe |
| 409 + `BLING_ORDER_SOURCE_REQUIRED` | enviar/corrigir a venda no Bling; não criar pedido no Fidelizei |
| 409 | tratar conflito ou cupom já utilizado |
| 429 | repetir com backoff |
| 5xx | manter a ação local pendente e repetir com idempotência |

## Homologação mínima

1. Cadastrar uma cliente nova no Fidelizei pelo PDV.
2. Criar o contato no Bling com o mesmo CPF.
3. Abrir o pedido antes ou depois do cadastro, no mesmo dia.
4. Confirmar o pedido no Bling.
5. Sincronizar e verificar que o Fidelizei gravou apenas o pedido `bling:<id>`.
6. Confirmar que os pontos foram lançados uma única vez.
7. Alterar o valor no Bling e verificar o ajuste da diferença.
8. Cancelar no Bling e verificar o estorno.
9. Validar um cupom usando o número oficial do pedido do Bling.

## Ajuste manual de saldo

No portal do lojista, abra **Clientes**, selecione a cliente e use **Ajustar pontos**. Informe crédito ou débito e uma justificativa.

Cada ajuste gera lançamento no extrato, notificação para a cliente e evento de auditoria com responsável, motivo, saldo anterior e saldo posterior.
