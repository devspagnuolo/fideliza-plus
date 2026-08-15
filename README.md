# Fideliza+

MVP SaaS multiempresa para fidelização e inteligência de crescimento de pequenos e médios varejistas. A primeira empresa piloto é a **Vivi Moda Plus Size**.

## O que já funciona

- login seguro por sessão e papéis de usuário;
- isolamento de dados por empresa no backend;
- CRM: listagem, cadastro e importação CSV de clientes;
- vendas e pontos: registro/importação de compras e crédito automático de pontos;
- dashboard com clientes, receita, vendas, ticket médio e recomendações iniciais;
- criação e listagem de campanhas em rascunho;
- extrato e resgate auditável de pontos;
- configuração de empresa, regra de pontos, unidades e equipe;
- segmentação CRM por atividade e valor;
- consentimento, exportação e anonimização de dados pessoais;
- rate limiting, proteção contra requisições forjadas e trilha de auditoria;
- banco SQLite, migração, seed idempotente e teste inicial de segurança;
- interface web responsiva para desktop e celular.
- portal separado do consumidor para adesão, saldo, extrato e benefícios;
- painel Fideliza+ Admin para empresas, planos, assinaturas e MRR;
- base da integração Bling com OAuth seguro e painel de conexão opcional.
- recuperação segura de senha e processamento automático das filas.
- autenticação em dois fatores compatível com aplicativos autenticadores.
- PWA instalável em celulares e computadores, com experiência offline segura.
- API pública versionada com chaves revogáveis e escopos de leitura.
- catálogo de recompensas com estoque e resgate transacional por pontos.
- experimentos A/B de campanhas e atribuição de receita por janela configurável.

## Executar localmente

Pré-requisito: Node.js 20 ou superior.

```bash
copy .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

No macOS/Linux, use `cp .env.example .env` no primeiro comando.

Acesse `http://localhost:5173` e entre com:

- e-mail: `admin@vivimoda.local`
- senha: `Vivi@123`

Essa credencial é somente para desenvolvimento. API: `http://localhost:3333`; saúde: `GET /health`.

Em produção, os acessos oficiais são `https://fidelizaplus.com.br` para empresas, `https://fidelizaplus.com.br/cliente/vivi-moda-plus-size` para consumidores da loja piloto e `https://fidelizaplus.com.br/admin` para a administração central do Fideliza+. Localmente, use `http://localhost:5173`, mantendo os mesmos caminhos. Configure as variáveis `PLATFORM_ADMIN_*` antes do primeiro acesso administrativo. Consulte `docs/PORTAIS-E-ASSINATURAS.md`.

Novas integrações devem usar o prefixo versionado `/api/v1` (por exemplo, `GET /api/v1/customers`). As rotas sem prefixo permanecem compatíveis com a interface atual durante a transição.

Integrações externas podem usar `GET /public/v1/customers` e `GET /public/v1/sales` com `Authorization: Bearer fz_live_...`. A chave é exibida somente na criação, armazenada como hash, limitada a 120 requisições por minuto e pode ser revogada nas configurações.

## Comandos

```bash
npm run dev          # web e API em modo desenvolvimento
npm run build        # valida e gera os dois pacotes
npm test             # testes automatizados
npm run db:migrate   # aplica a estrutura do banco
npm run db:seed      # cria o cenário piloto
npm run db:backup    # cria uma cópia segura em apps/api/backups
npm run db:verify-backup -- caminho/backup.db # comprova a integridade da cópia
```

Com `AUTO_BACKUP_ENABLED=true`, a API cria backups verificados automaticamente e aplica retenção por idade e quantidade. Consulte `docs/RELEASE-PRODUCAO.md` antes de liberar acesso público.

Com `WORKER_ENABLED=true`, a API processa automaticamente jobs, campanhas e expiração de pontos no intervalo definido por `WORKER_INTERVAL_MS`. Em instalações maiores, o mesmo worker pode ser executado separadamente sem alterar as regras do domínio.

## Importações CSV

Há arquivos prontos em `examples/`. Clientes usam as colunas `name,email,phone`. Vendas usam `external_id,customer_email,total,occurred_at`, com data no formato ISO 8601. O `external_id` impede que a mesma venda importada seja contabilizada duas vezes.

## Estrutura

```text
apps/
  api/   API, regras de negócio, autenticação e persistência
  web/   experiência React responsiva
docs/    decisões, segurança e backlog técnico
```

O diretório `sources/` é uma referência sincronizada e permanece intocado.

## Integração Bling

Para habilitar o botão de conexão, cadastre um aplicativo no Bling e preencha `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET` e `BLING_REDIRECT_URI` no `.env`. Sem essas variáveis, o painel mostra a integração como não configurada e todos os fluxos manuais continuam disponíveis. Depois da autorização, “Sincronizar agora” importa incrementalmente clientes e vendas pela fila persistente; repetições são idempotentes e não duplicam pontos.

Para atualização reativa, configure no aplicativo Bling o servidor `BLING_WEBHOOK_URL`. Eventos são autenticados por HMAC, deduplicados e processados de forma assíncrona. O painel de conciliação acompanha falhas, vendas sem cliente e o último evento recebido.

## Limites desta versão

Campanhas e Bling já possuem integrações opcionais, mas seu uso real depende de credenciais, consentimentos e homologação dos fornecedores. PostgreSQL gerenciado e aplicativos nativos Android/iOS permanecem evoluções; a PWA atende o piloto móvel. O desenho continua como monólito modular até existirem razões reais para separação.

## Estado do MVP

O escopo web piloto definido para a Vivi Moda está concluído. Consulte `docs/ACEITE-MVP.md` para os critérios verificados e `docs/OPERACAO.md` para backup, restauração e cuidados antes da produção pública.

## Homologação com Docker

Defina `SESSION_SECRET` no `.env` com pelo menos 32 caracteres e execute `npm run docker:up`. A interface ficará em `http://localhost:8080` e a API em `http://localhost:3333`. O banco é persistido no volume `fideliza_data`; execute `npm run docker:down` para parar sem apagar os dados.

Cada push e pull request executa testes, build, auditoria de dependências e build dos contêineres pelo GitHub Actions.

## Homologação pública

O `render.yaml` prepara uma API com disco persistente e uma interface estática. A criação dos recursos e qualquer cobrança exigem confirmação no painel do provedor. Consulte `docs/DEPLOY-RENDER.md` para o roteiro completo.

## Provedores de campanha

Campanhas de e-mail usam Resend e campanhas de WhatsApp usam a Cloud API oficial da Meta. Enquanto as respectivas variáveis da `.env.example` estiverem vazias, a fila funciona em modo simulado e nenhum contato externo é realizado. O envio real exige consentimento de marketing vigente, domínio de e-mail verificado e template de WhatsApp aprovado.
