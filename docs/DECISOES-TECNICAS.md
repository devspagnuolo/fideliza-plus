# Decisões técnicas — MVP

## Arquitetura

Foi escolhido um **monólito modular TypeScript**, dividido em aplicação web e API. Essa forma reduz custo operacional e complexidade, sem misturar as responsabilidades de interface, regras de negócio e persistência. Microserviços só devem ser considerados quando escala, equipe ou isolamento operacional justificarem o custo.

A API é organizada em routers de autenticação, administração, clientes/fidelidade, comércio e crescimento. O contrato público começa em `/api/v1`; rotas legadas sem prefixo são aliases temporários para manter o web MVP compatível. Integrações Bling e aplicativos móveis devem consumir somente a versão explícita.

## Stack

- **React + Vite:** interface rápida, responsiva e simples de hospedar em serviço estático.
- **Node.js + Express:** API madura, open source e adequada para integrações futuras.
- **SQLite + better-sqlite3:** zero custo e configuração no piloto. A camada SQL usa tipos portáveis para facilitar migração a PostgreSQL antes da produção compartilhada.
- **Zod:** validação explícita nas fronteiras da API.
- **Vitest:** testes rápidos em TypeScript.

## Multi-tenancy

O modelo adotado é banco compartilhado com coluna `tenant_id`. A empresa é derivada exclusivamente da sessão autenticada, nunca de um parâmetro fornecido pelo navegador. Toda consulta de negócio deve conter o filtro de empresa. Chaves e índices compostos evitam colisões entre empresas.

Para produção, recomenda-se PostgreSQL com Row Level Security como segunda camada de proteção e testes automatizados de vazamento entre tenants.

## Segurança

- senhas com `scrypt`, salt individual e comparação resistente a timing;
- sessões aleatórias armazenadas como hash e cookies `HttpOnly`/`SameSite`;
- cabeçalhos seguros com Helmet e CORS limitado ao web configurado;
- validação de entrada e limites de corpo;
- papéis iniciais `owner`, `manager` e `operator`.

Antes de produção: segredo obrigatório via cofre, HTTPS, rate limiting, proteção CSRF, logs de auditoria, política LGPD, recuperação de senha e 2FA para administradores.

## Evolução prevista

SQLite atende desenvolvimento e piloto controlado; PostgreSQL é o destino para produção. Bling deverá entrar como um adaptador assíncrono com idempotência por `external_id`. Um aplicativo móvel poderá consumir a mesma API após versionamento e autenticação apropriada. Nenhuma dessas evoluções bloqueia a validação do MVP web.
