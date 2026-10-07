# Especificação oficial — site público, conteúdo e integrações do Fidelizei

Status: base de produto para UX, Design, Engenharia, Growth e Marketing  
Princípio: comunicar apenas capacidades existentes ou claramente identificadas como roadmap.

## 1. Posicionamento

O Fidelizei é uma plataforma SaaS B2B de fidelização para empresas que desejam reconhecer clientes, automatizar pontos a partir de vendas, oferecer benefícios e acompanhar relacionamento e recorrência.

### Proposta de valor

> Transforme vendas em relacionamento contínuo, com pontos, benefícios e comunicação em uma operação integrada à sua empresa.

### Promessas permitidas

- programa de pontos e níveis de relacionamento;
- catálogo de recompensas e cupons de uso único;
- ofertas exclusivas no aplicativo do cliente;
- identificação do cliente e histórico de movimentações;
- integração Bling disponível conforme configuração e permissões do ERP;
- operação separada por empresa, com perfis e permissões;
- dashboards e recursos conforme o plano contratado;
- cobrança e assinatura integradas ao fluxo comercial do Fidelizei.

### Promessas que dependem de comprovação antes da publicação

- percentuais de aumento de vendas, retenção ou ticket médio;
- quantidade de clientes, transações ou empresas atendidas;
- SLA contratual específico;
- certificações não obtidas;
- integração pronta com Mercado Livre, Shopee, Mercado Pago, PagBank ou qualquer ERP diferente do Bling;
- SDKs oficiais que ainda não tenham pacote publicado e suporte definido;
- depoimentos, logotipos ou cases sem autorização expressa.

## 2. Arquitetura de navegação

### Menu principal

- Produto
  - Visão geral
  - Fidelidade e pontos
  - Recompensas e benefícios
  - Campanhas e relacionamento
  - Relatórios e gestão
- Soluções
  - Varejo
  - E-commerce
  - Serviços
  - Restaurantes
  - Farmácias
  - Pet shops
  - Franquias e multiunidades — publicar somente quando o recurso estiver comercialmente liberado
- Integrações
  - Marketplace
  - Bling
  - WhatsApp
  - API e webhooks
- Preços
- Conteúdos
  - Blog
  - Guias
  - Tutoriais
  - Central de ajuda
  - Documentação para desenvolvedores

### Ações permanentes no cabeçalho

- Sou cliente — `/cliente`
- Entrar como lojista — `/login`
- Começar teste grátis — `/planos`

O acesso `/admin` não deve aparecer na navegação pública.

### Rodapé

- Produto: visão geral, funcionalidades, integrações e preços;
- Soluções: segmentos efetivamente atendidos;
- Recursos: blog, tutoriais, ajuda, documentação e status;
- Empresa: sobre, contato e canal comercial;
- Legal: privacidade, termos, contrato, cookies e segurança;
- Acessos: lojista e cliente;
- dados oficiais da empresa e canais reais de contato;
- redes sociais apenas quando os perfis oficiais existirem.

## 3. Sitemap recomendado

### Páginas públicas indexáveis

- `/`
- `/produto`
- `/produto/fidelidade-e-pontos`
- `/produto/recompensas`
- `/produto/campanhas`
- `/produto/relatorios`
- `/solucoes/varejo`
- `/solucoes/ecommerce`
- `/solucoes/servicos`
- `/solucoes/restaurantes`
- `/solucoes/farmacias`
- `/solucoes/pet-shops`
- `/integracoes`
- `/integracoes/bling`
- `/integracoes/whatsapp`
- `/integracoes/api`
- `/planos`
- `/clientes` — publicar quando existirem cases autorizados; enquanto isso, redirecionar para produto
- `/blog`
- `/blog/:slug`
- `/guias`
- `/tutoriais`
- `/ajuda`
- `/ajuda/:slug`
- `/desenvolvedores`
- `/desenvolvedores/api`
- `/desenvolvedores/webhooks`
- `/desenvolvedores/autenticacao`
- `/seguranca`
- `/privacidade`
- `/termos`
- `/cookies`
- `/sobre`
- `/contato`

### Páginas transacionais não indexáveis

- `/login`
- `/cliente`
- `/cadastro` ou modal transacional dos planos
- `/recuperar-senha`
- `/redefinir-senha`
- `/admin`
- portais autenticados e callbacks OAuth

Aplicar `noindex, nofollow` nas páginas transacionais e bloquear URLs sensíveis no sitemap XML.

## 4. Home — wireframe e copy

### 4.1 Cabeçalho

Logo Fidelizei, navegação curta, acesso do cliente, acesso do lojista e CTA de teste grátis. Em telas pequenas, menu lateral acessível, foco controlado e alvos de toque de pelo menos 44 px.

### 4.2 Hero

**Título:** Faça seus clientes voltarem — e saiba o que realmente gera fidelidade.

**Texto:** Conecte vendas, pontos, benefícios e relacionamento em uma experiência personalizada para sua empresa e seus clientes.

**CTA principal:** Começar 7 dias grátis  
**CTA secundário:** Ver como funciona

Provas abaixo do CTA:

- nenhuma cobrança durante os 7 dias;
- implantação guiada;
- cancelamento conforme as condições contratuais apresentadas na adesão.

Visual: composição real do dashboard do lojista e do cartão fidelidade do cliente. Não usar dashboards fictícios com números inventados.

### 4.3 Problema e benefício

- vendas isoladas viram histórico acionável;
- clientes recebem benefícios compatíveis com seu nível;
- pedidos integrados podem gerar ou estornar pontos automaticamente;
- a empresa acompanha clientes, campanhas, recompensas e operação em um só lugar.

### 4.4 Como funciona

1. Configure o programa e as regras.
2. Conecte o Bling ou registre operações pelos recursos disponíveis.
3. Convide clientes para o aplicativo personalizado da loja.
4. Acompanhe pontos, níveis, recompensas, ofertas e relacionamento.

### 4.5 Módulos

- CRM e clientes;
- fidelidade e pontos;
- níveis e benefícios;
- recompensas e cupons;
- ofertas exclusivas;
- campanhas;
- integrações;
- relatórios e dashboards conforme o plano.

Cada card deve levar a uma página de produto e informar quando o recurso depende do plano.

### 4.6 Integrações

Mostrar três estados distintos:

- **Disponível:** integração validada e operável em produção;
- **Beta:** disponível para homologação controlada;
- **Planejada:** interesse de roadmap, sem CTA de conexão.

O Bling pode ser apresentado como disponível quando o fluxo OAuth/JWT estiver homologado. WhatsApp deve indicar exatamente quais mensagens transacionais estão disponíveis. Os demais provedores não devem aparecer como disponíveis sem implementação.

### 4.7 Resultados e clientes

Até existirem métricas auditáveis e autorização dos clientes, substituir números e depoimentos por:

- demonstração do fluxo real;
- compromisso de rastreabilidade;
- explicação de quais indicadores o cliente poderá acompanhar.

### 4.8 FAQ

- Como os pontos são calculados?
- O Fidelizei funciona sem ERP?
- Como funciona a integração com o Bling?
- O cliente precisa instalar aplicativo?
- Posso personalizar a experiência com a marca da empresa?
- Como funcionam os 7 dias grátis?
- O que acontece quando um pedido é cancelado?
- Os dados de empresas diferentes ficam separados?

### 4.9 CTA final

**Título:** Comece seu programa de fidelidade com uma operação preparada para crescer.  
**CTA:** Escolher meu plano

## 5. Produto e soluções

### Modelo de página de produto

1. proposta do módulo;
2. problema operacional resolvido;
3. fluxo real em três a cinco passos;
4. screenshot do sistema em uso;
5. regras, limites e dependências do plano;
6. integrações relacionadas;
7. FAQ específico;
8. CTA para teste.

### Modelo de página por segmento

As páginas segmentadas não devem prometer uma versão diferente do produto. Elas reorganizam os mesmos recursos segundo a jornada do setor:

- dores comuns e verificáveis;
- exemplo de programa de fidelidade adequado ao segmento;
- fluxo de cadastro, venda, pontuação e benefício;
- módulos aplicáveis;
- requisitos de integração;
- CTA para configurar uma operação de teste.

Cases só entram quando existirem resultados medidos e autorização. A Vivi Moda Plus Size pode virar case apenas depois de aprovação formal e definição de período, indicador inicial, indicador final e metodologia.

## 6. Integrações e marketplace

### Card de integração

- nome e logo autorizada;
- categoria;
- status real;
- dados sincronizados;
- direção do fluxo;
- pré-requisitos;
- plano mínimo, se aplicável;
- botão Ver integração;
- botão Conectar somente quando o conector estiver disponível.

### Página Bling

Seções:

1. o que a integração faz hoje;
2. pedidos, clientes e eventos efetivamente tratados;
3. como conectar via OAuth;
4. permissões necessárias;
5. atualização e estorno de pontos;
6. frequência e conciliação;
7. tratamento de erros;
8. segurança dos tokens;
9. FAQ;
10. acesso ao tutorial operacional.

## 7. Arquitetura correta da integração Bling

Referências oficiais:

- OAuth e aplicativos: https://developer.bling.com.br/aplicativos
- Migração JWT: https://developer.bling.com.br/migracao-jwt
- Webhooks: https://developer.bling.com.br/webhooks
- URL atual da API: https://developer.bling.com.br/migracao-url
- Referência OpenAPI: https://developer.bling.com.br/referencia

### 7.1 Fluxo de autorização

1. O lojista inicia a conexão no portal da empresa.
2. O backend cria um `state` criptograficamente aleatório, de uso único, com validade curta e vínculo ao tenant.
3. O navegador é direcionado ao Authorization Code do Bling.
4. O callback valida `state`, tenant, sessão e prazo antes de aceitar o `code`.
5. O backend troca o código por tokens; essa troca nunca ocorre no navegador.
6. A requisição de token inclui `enable-jwt: 1`.
7. Access token, refresh token, escopos e expiração são armazenados de forma protegida.
8. A conexão é marcada como ativa somente após uma chamada de validação bem-sucedida.

### 7.2 Armazenamento

- campos preparados para JWT de pelo menos 4 KiB;
- tokens criptografados em repouso com chave fora do banco;
- `client_secret` somente em segredo de ambiente, nunca no frontend ou em logs;
- metadados separados: tenant, scopes, `expires_at`, última renovação, último erro e status;
- mascaramento integral de tokens em logs e auditoria;
- rotação de chave com estratégia versionada.

### 7.3 Renovação automática

- renovar preventivamente antes da expiração;
- lock por tenant/conexão para evitar renovações concorrentes;
- incluir `enable-jwt: 1` também no refresh;
- atualizar access e refresh token de forma atômica;
- em `401`, permitir uma única renovação e uma única repetição da chamada;
- se o refresh falhar definitivamente, marcar `reconnect_required` e orientar nova autorização;
- não executar loops infinitos de renovação.

### 7.4 Requisições

- usar `https://api.bling.com.br/Api/v3`;
- enviar `Authorization: Bearer ...` e `enable-jwt: 1`;
- aplicar timeout, retry apenas para falhas transitórias e backoff com jitter;
- respeitar limites do provedor;
- registrar correlação, tenant, operação, status e latência sem dados sensíveis.

### 7.5 Webhooks e conciliação

- validar HMAC conforme a documentação do Bling;
- responder `2xx` rapidamente depois da persistência segura do evento;
- chave idempotente por evento/recurso;
- suportar duplicidade e entrega fora de ordem;
- processar em fila persistente;
- aplicar versão/data do evento antes de alterar estado;
- manter rotina de conciliação periódica para recuperar eventos ausentes;
- isolar eventos por tenant e registrar trilha de auditoria.

### 7.6 Estados operacionais exibidos ao lojista

- desconectado;
- conectando;
- conectado;
- sincronizando;
- atenção necessária;
- reconexão necessária;
- pausado.

Exibir última sincronização, último sucesso, último erro traduzido, itens processados, itens pendentes e ação recomendada.

## 8. Documentação pública

### Centro de ajuda — público não técnico

- primeiros passos;
- configuração da empresa;
- regras de pontos;
- níveis e benefícios;
- recompensas e validade;
- cadastro e importação de clientes;
- integração Bling passo a passo;
- campanhas;
- ofertas;
- faturamento e planos;
- privacidade e atendimento.

### Portal de desenvolvedores — técnico

Publicar somente superfícies de integração que sejam deliberadamente públicas.

- visão geral e ambientes;
- autenticação da API pública do Fidelizei;
- escopos;
- paginação, filtros e rate limits;
- erros padronizados;
- idempotência;
- webhooks e assinatura;
- exemplos mínimos com dados fictícios;
- changelog versionado;
- política de compatibilidade e descontinuação;
- status da plataforma.

Não publicar tokens, URLs internas, estrutura do banco, segredos, procedimentos administrativos ou detalhes que ampliem superfície de ataque.

### Especificação OpenAPI

- gerar OpenAPI a partir dos contratos efetivamente expostos;
- validar o arquivo no CI;
- servir documentação em `/desenvolvedores/api`;
- versionar endpoints públicos em `/v1`;
- exemplos sem dados reais;
- marcar endpoints beta;
- manter changelog entre versões.

## 9. Preços

Manter os planos comerciais reais do Fidelizei: Iniciante, Essencial, Crescimento e Profissional, salvo decisão comercial posterior. O site consome a mesma fonte de dados usada pelo administrador para preço, limites e recursos; não deve haver tabela duplicada no frontend.

Cada plano mostra:

- mensalidade vigente;
- usuários incluídos;
- limite de clientes ou uso, se houver;
- armazenamento, apenas se realmente medido e aplicado;
- dashboards disponíveis;
- campanhas e automações;
- integrações;
- API pública;
- suporte;
- multiunidade;
- auditoria e exportação;
- sete dias grátis e regra de cobrança após o teste.

## 10. SEO

### Fundamentos

- HTML semântico e hierarquia única de `h1`;
- metadados específicos por rota;
- canonical;
- sitemap XML e robots.txt;
- Open Graph e Twitter Cards;
- imagens WebP/AVIF com dimensões definidas;
- dados estruturados apenas verdadeiros;
- páginas públicas renderizáveis pelo crawler;
- URLs estáveis e redirects 301 quando necessário;
- Core Web Vitals monitorados em dispositivos reais.

### Schema.org

- `Organization` na home;
- `SoftwareApplication` ou `Product` na visão de produto, com preço apenas quando consistente com a fonte oficial;
- `FAQPage` nas FAQs visíveis;
- `Article` no blog;
- `BreadcrumbList` nas páginas internas;
- `HowTo` somente em tutoriais realmente sequenciais.

### Clusters de conteúdo

- programa de fidelidade para varejo;
- como criar regras de pontos;
- níveis de clientes e benefícios;
- integração de programa de fidelidade com Bling;
- retenção e recorrência;
- ofertas exclusivas para clientes;
- LGPD em programas de fidelidade.

## 11. CRO e jornada

### Jornada principal

1. Descoberta por conteúdo, indicação ou busca.
2. Entendimento da proposta na home ou solução segmentada.
3. Validação por demonstração real, segurança, preços e integração.
4. Escolha do plano.
5. Cadastro com CNPJ e endereço assistidos.
6. Aceite contratual e escolha de pagamento.
7. Teste de sete dias.
8. Onboarding orientado: empresa, regra, integração, primeiro cliente e primeira recompensa.
9. Ativação medida pelo primeiro ciclo completo de venda/pontos/benefício.

### Eventos de analytics

- `view_home`
- `view_product`
- `view_integration`
- `view_pricing`
- `select_plan`
- `start_trial`
- `complete_trial_signup`
- `start_erp_connection`
- `complete_erp_connection`
- `create_loyalty_rule`
- `create_first_reward`
- `invite_first_customer`
- `first_order_processed`

Eventos não podem carregar CPF, e-mail, telefone, token ou qualquer dado pessoal desnecessário.

## 12. Design system

### Direção visual

- premium, clara e operacional;
- azul-marinho como base institucional;
- verde/teal para ação, sucesso e conexão;
- fundos claros com contraste AA;
- gradientes usados com moderação;
- screenshots reais em molduras consistentes;
- evitar excesso de cards idênticos e blocos sem hierarquia.

### Tokens

Centralizar tokens já adotados pela marca em variáveis semânticas:

- `--color-brand-primary`
- `--color-brand-secondary`
- `--color-action-primary`
- `--color-surface`
- `--color-surface-muted`
- `--color-text`
- `--color-text-muted`
- `--color-success`
- `--color-warning`
- `--color-danger`
- `--color-border`

Não criar novos HEX paralelos antes de consolidar os tokens existentes do Fidelizei.

### Componentes

- Header e MobileNavigation;
- Footer;
- Hero;
- SectionHeading;
- Button e LinkButton;
- ProductScreenshot;
- FeatureGrid;
- WorkflowSteps;
- IntegrationCard e IntegrationStatus;
- PricingCard e FeatureComparison;
- FAQAccordion;
- ArticleCard;
- Breadcrumbs;
- TrustPanel;
- LeadForm;
- CookieConsent;
- EmptyState e ErrorState;
- SEO metadata por rota.

## 13. CMS e conteúdo

Começar simples: conteúdo versionado no repositório em MDX/Markdown com frontmatter validado. Migrar para CMS headless somente quando Marketing precisar publicar sem deploy e houver governança editorial.

Frontmatter mínimo:

- título;
- slug;
- resumo;
- autor real;
- data de publicação e revisão;
- categoria;
- palavras-chave;
- imagem social;
- status (`draft`, `review`, `published`);
- relações com produto, segmento e integração.

Workflow: rascunho, revisão técnica, revisão de marca/LGPD, publicação e revisão periódica.

## 14. Arquitetura técnica recomendada

O produto atual não deve ser reescrito apenas para atender a uma preferência de stack. Se o frontend existente já entrega React/TypeScript com bom roteamento, SEO e performance, evoluir incrementalmente é mais seguro. Next.js só deve ser adotado após análise de migração, ganhos de SSR/SSG, custo operacional e impacto nos portais autenticados.

Separação recomendada:

- site público e documentação com rotas indexáveis e conteúdo estático/cacheável;
- portais autenticados separados logicamente e marcados como não indexáveis;
- API multiempresa como única fonte de planos e capacidades;
- BFF/API pública somente quando houver contrato externo estável;
- fila persistente para integrações e webhooks;
- observabilidade, auditoria e correlação por tenant;
- feature flags para recursos beta;
- variáveis e textos preparados para internacionalização, sem traduzir antes de validar mercado.

### Performance

- divisão de bundle por rota;
- lazy load de módulos e screenshots;
- fontes locais ou com preload criterioso;
- nenhuma dependência pesada apenas para efeitos visuais;
- orçamento de JavaScript e imagem no CI;
- Lighthouse como regressão monitorada, não como promessa fixa isolada.

### Acessibilidade

- WCAG 2.2 AA como referência;
- foco visível;
- navegação por teclado;
- contraste mínimo;
- mensagens de erro associadas aos campos;
- modais com foco contido e restauração;
- suporte a `prefers-reduced-motion`;
- testes automatizados e validação manual.

## 15. Backlog priorizado

### Épico 1 — Fundamentos públicos

- consolidar rotas e navegação;
- eliminar CTAs duplicados;
- criar metadados, canonical, sitemap e robots;
- aplicar design system e acessibilidade;
- separar páginas indexáveis e transacionais;
- conectar preços à fonte administrativa única.

### Épico 2 — Home e produto

- nova home com copy e demonstrações reais;
- páginas dos módulos;
- screenshots responsivos;
- FAQ e CTA contextual;
- instrumentação de eventos sem dados pessoais.

### Épico 3 — Integrações

- marketplace com status real;
- landing do Bling;
- tutorial Bling;
- painel de saúde da conexão;
- OAuth/JWT e refresh automático;
- webhooks HMAC e conciliação;
- páginas de integrações planejadas sem CTA falso de conexão.

### Épico 4 — Documentação

- central de ajuda pesquisável;
- documentação pública versionada;
- OpenAPI do escopo público;
- webhooks do Fidelizei;
- changelog;
- status e política de descontinuação.

### Épico 5 — Soluções e conteúdo

- template de solução por segmento;
- publicar primeiro varejo e e-commerce, por aderência ao produto atual;
- calendário editorial;
- guias de onboarding e integrações;
- processo de aprovação de cases.

### Épico 6 — Conversão e onboarding

- funil de planos;
- cadastro assistido por CNPJ e CEP;
- pagamento e aceite contratual;
- checklist de ativação;
- recuperação de abandono com consentimento;
- dashboard de aquisição, ativação e conversão.

### Critérios de aceite globais

- nenhuma capability publicada sem correspondente funcional;
- nenhuma prova social sem autorização;
- nenhuma integração marcada como disponível sem homologação;
- responsividade em 320 px, tablet e desktop;
- acessibilidade AA nos fluxos principais;
- ausência de dados pessoais em analytics e logs;
- testes de navegação, links, formulários e permissões;
- documentação revisada junto com cada mudança de contrato da API.

