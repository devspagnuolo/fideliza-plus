# API pública do Fidelizei

Documentação do contrato atualmente publicado para integrações servidor a servidor. Esta API permite consultar clientes e vendas autorizados pela empresa titular da chave. Ela não transforma automaticamente qualquer ERP em uma integração: cada sistema externo ainda precisa implementar autenticação, mapeamento de campos, sincronização e tratamento de erros.

## Antes de começar

- A empresa precisa ter assinatura ativa ou em teste e um plano que inclua **API pública**.
- Somente o proprietário da empresa pode criar ou revogar chaves.
- Crie uma chave por sistema consumidor e conceda apenas os conjuntos de leitura necessários.
- A chave completa é exibida uma única vez. O banco guarda o hash, não a credencial original.
- Clientes inclui dados pessoais (nome, e-mail, telefone, CPF e saldo de pontos). Use esses dados apenas para a finalidade autorizada, restrinja o acesso, proteja o armazenamento e observe a LGPD.
- A API usa HTTPS e Bearer Token. Nunca coloque a chave em código de navegador, aplicativo móvel, URL, issue ou repositório.

## Criar uma chave de consulta

No portal do lojista, abra **Integrações → Chaves da API → Nova chave**, selecione **Consulta** e marque um ou ambos os conjuntos:

| Permissão | Escopo | Dados retornados |
| --- | --- | --- |
| Clientes e fidelidade | `customers:read` | Identificador, nome, e-mail, telefone, CPF, saldo de pontos e data de cadastro |
| Vendas | `sales:read` | Identificador, cliente, identificador externo, número do pedido, total em centavos, data, origem e situação de estorno |

O conjunto de clientes contém informação pessoal. Não conceda esse escopo se a integração só precisa ler vendas. A seleção é por conjunto de dados; a versão atual não oferece seleção de campos individuais.

Copie a chave `fz_live_…` no momento da criação e guarde-a em um cofre de segredos ou variável de ambiente do servidor integrador, por exemplo `FIDELIZEI_API_KEY`. Se perder a chave, revogue-a e crie outra.

## URL base

```text
https://api.fidelizaplus.com.br/public/v1
```

## Autenticação

Envie a chave no cabeçalho HTTP:

```http
Authorization: Bearer <API_KEY>
Accept: application/json
```

Exemplo de chamada sem expor a chave no histórico do shell:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $FIDELIZEI_API_KEY" \
  -H "Accept: application/json" \
  "https://api.fidelizaplus.com.br/public/v1/sales?limit=100&offset=0"
```

## Endpoints disponíveis

### Listar clientes

`GET /customers`  
Escopo necessário: `customers:read`

Campos atuais: `id`, `name`, `email`, `phone`, `cpf`, `points_balance`, `created_at`. Clientes excluídos não são retornados.

### Listar vendas

`GET /sales`  
Escopo necessário: `sales:read`

Campos atuais: `id`, `customer_id`, `external_id`, `order_number`, `total_cents`, `occurred_at`, `source`, `reversed_at`, `external_status`. O valor é expresso em centavos. Uma venda pode ter sido estornada; confira `reversed_at` e `external_status` antes de conciliar.

### Paginação

Ambos os endpoints aceitam:

- `limit`: quantidade de registros por chamada, padrão 500, mínimo 1 e máximo 500.
- `offset`: posição inicial, padrão 0.

Resposta:

```json
{
  "data": [],
  "pagination": {
    "limit": 100,
    "offset": 0,
    "hasMore": false,
    "nextOffset": null
  }
}
```

Quando `hasMore` for verdadeiro, use `nextOffset` na próxima chamada. Para importações longas, persista o avanço da paginação e faça consultas incrementais com a estratégia adequada ao sistema integrador. A API atual não promete cursor temporal, filtros por data ou ordenação configurável.

## Limites e erros

O limite atual é de **120 requisições por minuto por chave**. Respeite respostas e use backoff exponencial com jitter para erros temporários; não repita imediatamente em loop.

| HTTP | Significado comum | Ação recomendada |
| --- | --- | --- |
| 400 | Parâmetros inválidos | Corrija limit/offset e a chamada |
| 401 | Chave ausente, inválida, expirada ou revogada | Confira o segredo e gere outra chave se necessário |
| 403 | Escopo, plano ou assinatura não permite a operação | Peça ao proprietário para conferir escopos e plano |
| 429 | Limite de requisições excedido | Aguarde e aplique backoff |
| 5xx | Falha temporária do serviço | Tente novamente com backoff e registre o incidente |

Não registre o valor completo do cabeçalho Authorization em logs.

## Integração com outros sistemas

Para integrar loja, identidade, benefícios, resgate de cupons e conciliação autoritativa com Bling, consulte o [guia StoreOS ↔ Fidelizei ↔ Bling](INTEGRACAO-STOREOS-FIDELIZEI.md). A integração usa permissões próprias, reserva idempotente e eventos incrementais.


Uma conexão real precisa de mais que uma chave. O sistema consumidor deve implementar este fluxo:

1. Armazenar a chave em backend seguro.
2. Consultar os endpoints concedidos via HTTPS.
3. Mapear identificadores e campos para seu próprio modelo de dados.
4. Tratar paginação, duplicidade, estorno, reprocessamento e indisponibilidade.
5. Registrar data/resultado de sincronização sem guardar a credencial em logs.

A chave de consulta Fidelizei não substitui o OAuth do Bling ou as credenciais próprias de outro ERP. O conector Bling usa seu fluxo de autorização específico. Para cadastrar um novo ERP, é necessário desenvolver e homologar um conector para a API do fornecedor.

## PDV e escrita

O portal mantém um perfil operacional distinto para PDV. Ele inclui escopos de leitura/escrita de clientes e vendas e validação de recompensas (`customers:write`, `sales:write`, `rewards:validate`, além das leituras). A criação e o uso desse perfil dependem de plano com integração ERP. Não conceda esses escopos a integrações que só precisam consultar.

A API pública documentada neste momento expõe leitura de clientes e vendas. Operações de escrita e validação de recompensa pertencem aos fluxos de integração autorizados e não devem ser inferidas como endpoints REST públicos de consulta.

## Revogar e rotacionar

Em **Integrações → Chaves da API**, revogue chaves antigas ou comprometidas. A revogação desativa o acesso imediatamente. Para rotação, crie uma nova chave, atualize o segredo no integrador, confirme a conexão e então revogue a chave anterior.

## Exemplo mínimo em Node.js

```js
const baseUrl = 'https://api.fidelizaplus.com.br/public/v1';

async function listSales({ limit = 100, offset = 0 } = {}) {
  const response = await fetch(
    `${baseUrl}/sales?limit=${limit}&offset=${offset}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.FIDELIZEI_API_KEY}`,
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Fidelizei API respondeu HTTP ${response.status}`);
  }

  return response.json();
}
```

## Segurança e suporte

- Use uma chave separada para cada integração/ambiente.
- Não compartilhe chaves entre lojas; cada credencial pertence à empresa que a criou.
- Restrinja e audite quem pode acessar o segredo no sistema integrador.
- Em caso de vazamento, revogue primeiro e só depois investigue logs e gere uma nova chave.
- Consulte a [central de ajuda](/faq) e o guia [Escolher permissões da API](/blog/chaves-api-permissoes).
