# Homologação no Render

## Ativação do Bling

1. Crie no portal Bling Developers um aplicativo privado para a conta piloto.
2. Use como redirecionamento `https://fideliza-plus-api.onrender.com/integrations/bling/callback`.
3. Selecione ao menos os escopos de contatos e vendas/pedidos.
4. Copie `client_id` e `client_secret` para `BLING_CLIENT_ID` e `BLING_CLIENT_SECRET` no serviço `fideliza-plus-api` do Render.
5. Nunca envie o `client_secret` por mensagem ou captura de tela.
6. Após o deploy, clique em **Conectar Bling**, autorize e execute **Sincronizar agora**.

O fluxo usa Authorization Code, `state` contra CSRF, troca no servidor, JWT e armazenamento criptografado dos tokens.

O arquivo `render.yaml` descreve dois serviços: a interface estática e a API Docker com disco persistente de 1 GB em `/data`. O disco guarda banco e backups e deve permanecer ligado a uma única instância enquanto o MVP usar SQLite.

## Criação

1. crie uma conta ou workspace no Render e conecte o repositório privado `devspagnuolo/fideliza-plus`;
2. escolha **New Blueprint** e selecione a branch `main`;
3. revise os dois serviços e o custo apresentado antes de confirmar;
4. mantenha os nomes previstos no Blueprint ou ajuste `WEB_ORIGIN` e `VITE_API_URL` para as URLs realmente geradas;
5. depois do primeiro deploy, execute `npm run smoke` localmente apontando `SMOKE_API_URL` e `SMOKE_WEB_URL` para as URLs públicas;
6. altere a senha piloto, crie o usuário real da Vivi Moda e ative 2FA.

## Variáveis opcionais

Resend, Meta WhatsApp e Bling permanecem desativados até que suas credenciais sejam adicionadas como segredos no painel. Nunca grave chaves no repositório. Configure domínio próprio somente depois da homologação nas URLs temporárias.

## Limites e evolução

O disco permite somente uma instância e causa uma breve interrupção durante deploys. Isso é aceitável para o piloto. Migre para PostgreSQL antes de escalar horizontalmente. Mantenha uma segunda cópia dos backups fora do Render, apesar dos snapshots diários do disco.
