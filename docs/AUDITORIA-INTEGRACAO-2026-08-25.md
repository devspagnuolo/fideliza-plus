# Auditoria de integração SaaS — 25/08/2026

## Escopo homologado

Esta revisão cobre os três contextos isolados da plataforma: Administração Fideliza Plus, Empresa/Lojista e Cliente final. A validação combina compilação de produção, testes automatizados, isolamento por `tenant_id`, trilha de auditoria e navegação responsiva.

## Cadeias funcionais concluídas

### Atendimento

1. O cliente abre o chamado no aplicativo.
2. A solicitação cria, na mesma transação, o registro do cliente e o chamado operacional.
3. O lojista visualiza a fila em Clientes > Atendimento; a Administração visualiza a mesma ocorrência em Suporte > Chamados.
4. Respostas retornam ao aplicativo e geram notificação.
5. Lojista e Administração podem ajustar pontos ou reprocessar um pedido; toda ação cria evento, lançamento no extrato e auditoria.

### Ofertas e intenção de compra

1. O lojista publica uma oferta com preço, estoque, período e imagem opcional.
2. O aplicativo exibe apenas ofertas publicadas e vigentes da loja de origem.
3. O cliente sinaliza interesse e escolhe o canal de contato.
4. O lojista acompanha a oportunidade nos estados novo, contatado, reservado, convertido, recusado ou cancelado.

### Benefícios

- Cupom: desconto percentual ou fixo e pedido mínimo.
- Produto: SKU, estoque e imagem obrigatória.
- Edição, arquivamento com histórico e exclusão segura sem resgates.
- Resgate transacional e código de uso único vinculado ao pedido.

### Planos e cobrança

1. O lojista consulta plano, limites e catálogo disponível.
2. A mudança gera solicitação pendente, sem alterar a assinatura silenciosamente.
3. A Administração aprova ou recusa com parecer obrigatório.
4. A aprovação atualiza a assinatura e registra evento financeiro/auditoria.
5. Faturas possuem conciliação, documentos, histórico de follow-up, canal, resultado e próxima ação.

## Controles verificados

- Sessões separadas para Administração, Empresa e Cliente.
- Escopo de empresa aplicado no backend, inclusive em ofertas, interesses e chamados.
- Requisições mutáveis protegidas pelo cabeçalho da aplicação.
- Senhas armazenadas como hash; tokens de sessão e recuperação armazenados como hash.
- Ajustes de saldo rejeitam débito que produziria saldo negativo.
- Reset de homologação remove dependências na ordem correta e preserva Administração central, empresa e contrato.
- Alterações críticas geram trilha de auditoria.
- Migrações são incrementais e preservam chamados existentes, vinculando-os à nova central.

## Evidência automatizada

- `npm run build`: API TypeScript e aplicação Vite de produção.
- `npm test`: suíte de API, segurança, multiempresa, portal, Bling, fidelidade e fluxos SaaS.
- `src/saas-workflows.test.ts`: homologação integrada Cliente → Empresa → Administração.

## Dependências externas que exigem validação operacional

O código não consegue garantir disponibilidade de terceiros. Antes de cada lançamento devem ser validados no ambiente Render:

- credenciais e permissões atuais do Bling;
- domínio e chave do Resend;
- token, número e template aprovado da Meta/WhatsApp;
- URLs públicas, TLS e variáveis secretas;
- backup recente e restauração verificada;
- método de pagamento e emissão fiscal, quando o gateway financeiro for contratado.

Integrações de pagamento, nota fiscal e envio de mensagens permanecem dependentes dos respectivos provedores. A plataforma já mantém contas a receber, eventos, notificações e follow-ups, mas não deve marcar uma cobrança como liquidada sem webhook ou conciliação válida do futuro gateway.

## Critério de liberação

A versão pode seguir para homologação do piloto quando build e suíte estiverem verdes, o smoke test público responder, o backup tiver restauração verificada e os testes manuais dos três perfis forem executados com dados não produtivos.
