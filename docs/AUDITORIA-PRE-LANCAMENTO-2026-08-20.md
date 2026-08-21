# Auditoria pré-lançamento — piloto Vivi Moda Plus Size

**Data da auditoria:** 20–21/08/2026

**Data planejada do piloto:** 22/08/2026

**Escopo:** portal administrativo Fideliza Plus, portal lojista e portal do cliente final.

**Parecer:** **apto condicionalmente para piloto controlado**, após cumprir os bloqueios P0 deste documento. Não representa liberação para venda pública ou garantia de risco zero.

## 1. Evidências técnicas

| Controle | Resultado | Evidência |
|---|---:|---|
| Build de produção da API e do portal web | Aprovado | TypeScript e Vite concluídos sem erro |
| Smoke test do pacote compilado | Aprovado localmente | API, banco e interface web responderam corretamente sobre base limpa |
| Regressão automatizada | Aprovada | 17 arquivos e 49 cenários aprovados |
| Dependências conhecidas | Aprovado | `npm audit`: 0 vulnerabilidades conhecidas |
| Navegação dos três perfis | Aprovada localmente | Admin, lojista e cliente final autenticados e navegáveis |
| Multiempresa | Aprovado | isolamento de clientes, usuários, vendas, recompensas, chaves e sessões coberto por testes |
| Fidelidade | Aprovado | crédito, não duplicidade, estorno, reativação e saldo devedor cobertos |
| Integração Bling | Aprovado em regressão | associação por CPF, reprocessamento, exclusão, cancelamento, eventos fora de ordem e fallback HTTP 403 |
| Recompensas | Aprovado | criação, edição, exclusão/arquivamento, estoque, saldo e resgate transacional |
| Segurança de sessão | Aprovado | empresa suspensa/bloqueada perde sessão e não autentica; publicação do portal é explícita |
| Credenciais versionadas | Aprovado | a senha de produção anteriormente informada não foi encontrada nos arquivos versionados |
| Backup da aplicação | Aprovado em teste | geração, integridade e abertura da cópia verificadas |
| Build Docker local | Não executado nesta estação | Docker não está instalado; o pipeline GitHub deve validar o contêiner no commit publicado |

## 2. Homologação navegável

### Administração da plataforma

- autenticação de Super Admin;
- dashboard executivo, empresas, usuários, financeiro e saúde operacional;
- cadastro de nova empresa com consulta de CNPJ e seleção de plano;
- listagem e detalhe da empresa;
- assinaturas, cobranças e contas a receber;
- publicação e retirada do portal do consumidor por empresa;
- rotação da senha do Super Admin;
- submenus críticos “Nova empresa” e “Cobranças” carregando conteúdo e controles.

### Lojista — Vivi Moda Plus Size

- autenticação sem credenciais previamente preenchidas;
- dashboard, períodos, CRM, vendas, campanhas e configurações;
- clientes com adesão separados dos cadastros importados ainda não inscritos;
- filtro de vendas por origem e número do pedido;
- catálogo de recompensas gerenciável;
- perfil, equipe, senha, MFA, ERP, Bling e chaves de API;
- indicadores de identificação considerando somente consumidores com adesão completa.

### Cliente final

- seleção apenas de lojas com portal explicitamente publicado;
- cadastro e autenticação por loja e CPF;
- dashboard, extrato, compras, catálogo, resgates, promoções e notificações;
- suporte, perfil, preferências, segurança e privacidade;
- bloqueio imediato da sessão se a loja for suspensa, bloqueada ou retirar o portal.

## 3. Correções realizadas nesta auditoria

- remoção do seed automático em produção;
- remoção das credenciais piloto pré-preenchidas no login;
- bloqueio de autenticação e sessões de empresas suspensas ou bloqueadas;
- publicação explícita do portal do consumidor por empresa;
- portal da Vivi Moda habilitado em primeira instalação de desenvolvimento;
- métricas de clientes, identificação e GIE alinhadas à adesão completa;
- rotação de senha do Super Admin com encerramento das demais sessões;
- impedimento de exigir MFA antes de o usuário configurá-lo;
- fila de boas-vindas criada no cadastro do consumidor;
- proteção do portal do cliente contra lojas indisponíveis.
- relatório administrativo personalizado convertido de formulário demonstrativo para gestão persistente e auditável;
- teste do ciclo Bling corrigido para usar uma linha do tempo relativa, preservando a validação de eventos fora de ordem em qualquer data de execução.

## 4. Bloqueios P0 antes de abrir o piloto

1. Publicar o commit auditado na `main` e aguardar CI, build Docker e deploy do Render concluírem sem erro.
2. Executar `npm run smoke` contra os endereços publicados e repetir os três logins em produção.
3. Limpar somente os registros demonstrativos conhecidos da base de produção, mediante autorização específica e backup anterior:
   - vendas de origem `seed` com identificadores `SEED-1` a `SEED-4`;
   - clientes demonstrativos Ana, Beatriz, Carla e Daniela;
   - suspender ou arquivar a empresa de teste que não pertence ao piloto.
4. Trocar as senhas já divulgadas do Super Admin e da proprietária da Vivi Moda; não reutilizá-las.
5. Ativar MFA no Super Admin e na conta proprietária da Vivi Moda.
6. Confirmar no commit publicado um ciclo real controlado: cadastro do cliente, pedido Bling com CPF, crédito de pontos, cancelamento/estorno e reativação.
7. Confirmar que o backup automático foi criado no disco persistente do Render antes do lançamento e registrar responsável pelo incidente.

## 5. Limitações aceitas somente para o piloto controlado

- Sem `RESEND_API_KEY` e `EMAIL_FROM`, recuperação de senha e boas-vindas ficam registradas, mas o e-mail não é entregue.
- A posse do e-mail ou celular do cliente ainda não é validada por código.
- Cobranças internas não movimentam dinheiro: Asaas, cartão, boleto e emissão fiscal serão uma fase posterior.
- O banco SQLite com um único serviço atende o piloto, mas não deve ser escalado horizontalmente.
- A segunda cópia criptografada externa do backup, monitoramento externo e ensaio real de restauração ainda precisam ser concluídos.
- Revisão de segurança independente e validação jurídica/LGPD continuam obrigatórias antes de abertura pública ampla.

## 6. Critério de decisão

### Go para o piloto

Todos os itens P0 concluídos, sem erros críticos nos logs, Bling conciliado, credenciais rotacionadas e rollback/backup confirmados.

### No-go

Falha no deploy/CI, divergência de pontos, pedido duplicado, estorno incorreto, quebra de isolamento entre empresas, falha de login dos três perfis, backup indisponível ou credencial conhecida ainda ativa.

## 7. Próxima fase após estabilização do piloto

1. Resend ou outro provedor transacional, validação de e-mail/celular e templates por loja.
2. Asaas em sandbox: cliente de cobrança, cartão tokenizado, boleto/Pix, webhooks idempotentes, conciliação e régua de inadimplência.
3. Nota fiscal por provedor homologado e vínculo com faturas.
4. Observabilidade externa, alertas, segunda cópia de backup e exercício de restauração.
5. Revisão independente de segurança, privacidade, termos e operação de suporte.
