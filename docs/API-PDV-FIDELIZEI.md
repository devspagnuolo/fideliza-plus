# API do PDV Fidelizei

Esta documentação conecta um PDV à empresa dona da chave de API. A primeira implantação é destinada à **Vivi Moda Plus Size**, mas o contrato é multiempresa: a empresa é identificada pela chave e nunca por um `tenantId` enviado pelo caixa.

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

Não envie a chave ao navegador, não a grave no repositório e não a reutilize em outro sistema. Cadastre uma chave chamada `PDV Vivi Moda Plus Size`; ela pode ser revogada pelo portal da loja a qualquer momento.

## Escopos do perfil PDV

| Escopo | Uso |
|---|---|
| `customers:read` | localizar cartão/cliente por CPF |
| `customers:write` | criar ou atualizar dados do consumidor |
| `sales:read` | consultar vendas quando necessário |
| `sales:write` | lançar e estornar vendas |
| `rewards:validate` | utilizar um cupom apresentado no caixa |

O perfil PDV é liberado pela capacidade **Integração ERP**, presente nos planos da plataforma. A chave de consulta genérica continua restrita à capacidade API pública.

## Fluxo recomendado de caixa

1. Leia o código de barras do cartão ou digite o CPF.
2. Consulte a cliente por CPF.
3. Se não existir, faça o cadastro e registre a adesão somente após consentimento explícito ao programa.
4. Se houver cupom, consuma o código antes de finalizar o desconto. O consumo é único e atômico.
5. Após concluir a venda, registre-a usando o identificador imutável do pedido do PDV.
6. Em caso de cancelamento, estorne usando exatamente o mesmo identificador externo.

## Endpoints

### Localizar cliente

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

`404` significa que o CPF não participa do programa daquela loja. Não existe acesso a dados de outras empresas.

### Cadastrar ou atualizar cliente

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

`programConsent: true` só deve ser enviado quando a cliente aceitar participar. Para adesão são exigidos nome, CPF e celular; o Fidelizei registra o consentimento com origem `pdv`. Sem adesão, a cliente pode ser cadastrada, mas não recebe pontos automaticamente.

### Registrar venda

```http
POST /sales
```

```json
{
  "externalSaleId": "vivi-20261008-000123",
  "orderNumber": "000123",
  "customerCpf": "52998224725",
  "totalCents": 12500,
  "occurredAt": "2026-10-08T15:30:00.000Z"
}
```

`totalCents` deve sempre ser inteiro em centavos. O valor `12500` corresponde a R$ 125,00.

O `externalSaleId` é obrigatório e deve ser imutável por venda. Repetir a mesma chamada com o mesmo identificador e valor retorna `200` com `idempotent: true`; não gera pontos novamente. Reutilizar o mesmo identificador com outro valor retorna `409`.

Resposta de exemplo:

```json
{
  "data": {
    "id": "uuid",
    "externalId": "pdv:vivi-20261008-000123",
    "points": 125,
    "eligibleForPoints": true,
    "idempotent": false
  }
}
```

Quando não houver CPF, a venda pode ser registrada sem `customerCpf`; ela não gera pontos. Quando o CPF existir mas a adesão estiver pendente, a venda também fica sem pontuação até a adesão ser feita.

### Estornar venda

```http
POST /sales/vivi-20261008-000123/reverse
```

O estorno é idempotente: uma segunda chamada retorna sucesso sem repetir a retirada dos pontos. O saldo é reconciliado a partir do ledger de fidelidade.

### Consumir cupom no caixa

O aplicativo gera um código quando a cliente toca em **Usar cupom**. No caixa, envie:

```http
POST /redemptions/consume
```

```json
{
  "code": "FZ-AB12CD34",
  "orderNumber": "000123"
}
```

Resposta:

```json
{
  "data": {
    "status": "used",
    "orderNumber": "000123",
    "reward": {
      "name": "Cupom 20%",
      "discountType": "percent",
      "discountValue": 20,
      "minimumOrderCents": 0
    }
  }
}
```

O endpoint já marca o cupom como utilizado na mesma transação. Um código usado, vencido, inexistente ou ainda não liberado não pode ser aplicado.

## Tratamento obrigatório de respostas

| Código | Ação do PDV |
|---:|---|
| 200/201 | confirmar a operação localmente |
| 400 | corrigir dados do formulário; não repetir automaticamente |
| 401 | chave ausente, inválida, vencida ou revogada; bloquear integração e avisar administrador |
| 403 | escopo ou plano não liberado; não tentar contornar |
| 404 | cliente, venda ou cupom não pertence à loja/não existe |
| 409 | conflito, cupom já utilizado ou venda já existente com valor diferente |
| 429 | aguardar e repetir com backoff; limite atual é 120 requisições por minuto por chave |
| 5xx | manter operação local pendente e reenviar depois com o mesmo `externalSaleId` |

## Segurança e homologação

- Use HTTPS; a URL de produção já opera com TLS.
- Armazene `FIDELIZEI_API_KEY` em cofre de segredos ou variável de ambiente do servidor do PDV.
- Nunca exponha a chave em aplicativo cliente, JavaScript público, recibo ou log de erro.
- Gere uma chave exclusiva para o PDV e revogue-a imediatamente se houver suspeita de vazamento.
- Homologue: uma cliente já cadastrada, uma adesão nova, uma venda, um reenvio da mesma venda, um estorno e um cupom usado duas vezes.
- Confirme no portal da loja o extrato, o saldo e a venda antes de colocar o caixa em operação.
