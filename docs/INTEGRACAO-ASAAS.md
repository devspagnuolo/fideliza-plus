# Integração Asaas — cobrança da plataforma

O Fideliza Plus usa o Asaas como gateway das assinaturas das empresas. O fluxo implementado cria a conta a receber local, cria a cobrança no Asaas e mantém os dois lados conciliados por webhook idempotente.

## Implantação segura

1. Crie uma conta no **Sandbox do Asaas** e gere uma chave de API.
2. No serviço `fideliza-plus-api` do Render, configure:
   - `ASAAS_ENVIRONMENT=sandbox`
   - `ASAAS_BILLING_ENABLED=true`
   - `ASAAS_API_KEY=<chave do sandbox>`
   - `ASAAS_WEBHOOK_TOKEN=<segredo aleatório com ao menos 32 caracteres>`
   - `ASAAS_WEBHOOK_URL=https://api.fidelizaplus.com.br/webhooks/asaas`
   - `ASAAS_NOTIFICATION_EMAIL=contato@fidelizaplus.com.br`
3. Faça novo deploy e, no painel Administrador > Empresas > Cobranças, clique em **Configurar webhook**.
4. Cadastre uma empresa de homologação com CNPJ e e-mail válidos, plano pago e vencimento em até dez dias.
5. Execute o ciclo financeiro e valide a cobrança no Sandbox, o link da fatura, o boleto e a baixa por webhook.

Somente depois da homologação altere `ASAAS_ENVIRONMENT` para `production` e substitua `ASAAS_API_KEY` pela chave de produção. Nunca reutilize a chave do Sandbox. Faça a primeira implantação produtiva com `ASAAS_BILLING_ENABLED=false`, valide a conexão e configure o webhook. Só então altere a variável para `true` e execute uma cobrança controlada de baixo valor.

Os identificadores externos ficam vinculados ao ambiente em que foram criados. Ao migrar de Sandbox para Produção, clientes e cobranças de teste não são reutilizados na conta real.

## Comportamento operacional

- O ciclo é executado automaticamente uma vez ao dia pelo worker e também pode ser disparado pelo administrador.
- A chave lógica `assinatura + vencimento` evita faturas duplicadas.
- Uma fatura que já possui `external_payment_id` não é recriada no Asaas.
- Eventos repetidos do webhook são ignorados pelo identificador externo.
- Pagamento recebido ou confirmado ativa a assinatura e avança a vigência em um mês.
- Vencimento sem pagamento marca a fatura e a assinatura como inadimplentes.
- O cartão deve ser informado na página segura hospedada pelo Asaas; o Fideliza Plus não armazena número ou CVV.

## Nota fiscal

A automação de NFS-e depende da configuração fiscal e municipal da conta Asaas e da habilitação desse recurso na conta. A plataforma já guarda o link do documento fiscal, mas a emissão automática deve ser ativada somente após a validação tributária da empresa Fideliza Plus.

## Recuperação e auditoria

Em caso de indisponibilidade do Asaas, a conta a receber local permanece registrada e o painel apresenta a falha por empresa. Reexecutar o ciclo é seguro. Para cada cobrança ficam disponíveis eventos, status externo, última sincronização e follow-ups administrativos.
