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

## Entrega de campanhas

E-mail usa a API REST do Resend, com chave restrita a envio, remetente de domínio verificado e chave de idempotência por entrega. WhatsApp usa diretamente a Graph API oficial da Meta e somente templates previamente aprovados; o nome do template fica associado à campanha.

A fila é persistida no banco e possui unicidade por campanha e cliente. Apenas clientes com consentimento de marketing vigente e contato compatível entram na fila. Preparação e processamento exigem papel `owner` ou `manager`, ficam na auditoria e nunca cruzam empresas.

Sem credenciais, o processador opera em modo simulado e registra o resultado sem transmitir dados. Isso permite homologar segmentação, consentimento e volume antes de ativar provedores externos. Para produção, o processamento manual deve ser substituído por um worker agendado com retentativas e controle de vazão.

## Jobs assíncronos

Importações e atualização do GIE usam uma fila persistente no mesmo banco, preservando a simplicidade do monólito. Jobs são isolados por empresa, possuem tentativas e estados explícitos, e trabalhos interrompidos há mais de 15 minutos voltam à fila. O conteúdo CSV é removido assim que o job termina, reduzindo retenção desnecessária de dados pessoais.

No piloto, o processamento é acionado pela aplicação. Em produção, o mesmo processador deve rodar como worker separado ou tarefa agendada, sem exigir a adoção prematura de um broker externo.

## Integração Bling

O Bling entra como adaptador do monólito modular e usa OAuth 2.0 com JWT. O estado temporário da autorização é aleatório, armazenado somente como hash, vinculado à empresa e ao usuário e expira em dez minutos. Tokens de acesso e renovação são protegidos com AES-256-GCM antes de chegar ao banco e nunca são enviados à interface.

A conexão é exclusiva do proprietário da empresa. A sincronização roda como job persistente, renova tokens automaticamente, respeita o limite de três requisições por segundo e busca alterações posteriores à última execução concluída. Clientes e vendas usam identificadores externos por empresa; assim, repetir uma sincronização atualiza cadastros, não duplica vendas nem concede pontos novamente. A ausência de credenciais mantém o recurso desativado sem afetar cadastros e importações manuais. Webhooks e reconciliação observável permanecem como próximas etapas.
