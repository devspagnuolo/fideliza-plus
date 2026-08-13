# Fideliza+

MVP SaaS multiempresa para fidelização e inteligência de crescimento de pequenos e médios varejistas. A primeira empresa piloto é a **Vivi Moda Plus Size**.

## O que já funciona

- login seguro por sessão e papéis de usuário;
- isolamento de dados por empresa no backend;
- CRM: listagem e cadastro de clientes;
- vendas e pontos: APIs para registrar compras e creditar pontos automaticamente;
- dashboard com clientes, receita, vendas, ticket médio e recomendações iniciais;
- base de campanhas em rascunho;
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

## Comandos

```bash
npm run dev          # web e API em modo desenvolvimento
npm run build        # valida e gera os dois pacotes
npm test             # testes automatizados
npm run db:migrate   # aplica a estrutura do banco
npm run db:seed      # cria o cenário piloto
```

## Estrutura

```text
apps/
  api/   API, regras de negócio, autenticação e persistência
  web/   experiência React responsiva
docs/    decisões, segurança e backlog técnico
```

O diretório `sources/` é uma referência sincronizada e permanece intocado.

## Limites desta versão

A importação CSV, resgate de pontos, criação completa de usuários, disparo de campanhas e integração Bling estão planejados, mas ainda não têm interface final. O desenho mantém essas capacidades dentro do monólito modular até existirem razões operacionais para separá-las.
