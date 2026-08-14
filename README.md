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

Novas integrações devem usar o prefixo versionado `/api/v1` (por exemplo, `GET /api/v1/customers`). As rotas sem prefixo permanecem compatíveis com a interface atual durante a transição.

## Comandos

```bash
npm run dev          # web e API em modo desenvolvimento
npm run build        # valida e gera os dois pacotes
npm test             # testes automatizados
npm run db:migrate   # aplica a estrutura do banco
npm run db:seed      # cria o cenário piloto
npm run db:backup    # cria uma cópia segura em apps/api/backups
```

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

## Limites desta versão

O disparo real de campanhas, integração Bling, PostgreSQL gerenciado e aplicativos Android/iOS são evoluções pós-MVP. Campanhas permanecem em rascunho de propósito: nenhum contato é enviado sem seleção de provedor, consentimento operacional e aprovação do conteúdo. O desenho mantém essas capacidades dentro do monólito modular até existirem razões reais para separá-las.

## Estado do MVP

O escopo web piloto definido para a Vivi Moda está concluído. Consulte `docs/ACEITE-MVP.md` para os critérios verificados e `docs/OPERACAO.md` para backup, restauração e cuidados antes da produção pública.

## Homologação com Docker

Defina `SESSION_SECRET` no `.env` com pelo menos 32 caracteres e execute `npm run docker:up`. A interface ficará em `http://localhost:8080` e a API em `http://localhost:3333`. O banco é persistido no volume `fideliza_data`; execute `npm run docker:down` para parar sem apagar os dados.

Cada push e pull request executa testes, build, auditoria de dependências e build dos contêineres pelo GitHub Actions.

## Provedores de campanha

Campanhas de e-mail usam Resend e campanhas de WhatsApp usam a Cloud API oficial da Meta. Enquanto as respectivas variáveis da `.env.example` estiverem vazias, a fila funciona em modo simulado e nenhum contato externo é realizado. O envio real exige consentimento de marketing vigente, domínio de e-mail verificado e template de WhatsApp aprovado.
