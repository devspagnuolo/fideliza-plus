# Operação do piloto

## Backup automático e manual

Ative `AUTO_BACKUP_ENABLED=true` para gerar uma cópia verificada ao iniciar a API e depois no intervalo definido por `BACKUP_INTERVAL_HOURS`. A retenção combina idade (`BACKUP_RETENTION_DAYS`) e quantidade (`BACKUP_MAX_FILES`). No Docker, mantenha `BACKUP_DIRECTORY` dentro de `/data`.

Para uma cópia manual, execute `npm run db:backup`. O processo só informa sucesso depois de abrir o arquivo, verificar sua integridade e confirmar as tabelas essenciais. Mantenha outra cópia criptografada fora do servidor.

### Cópia externa criptografada

Com `BACKUP_S3_BUCKET` definido, cada backup verificado é compactado, criptografado com AES-256-GCM (`BACKUP_ENCRYPTION_KEY`) e enviado para um bucket compatível com S3 (Cloudflare R2, Backblaze B2 ou AWS S3). Variáveis: `BACKUP_S3_ENDPOINT` (HTTPS), `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_REGION` (`auto` no R2) e `BACKUP_S3_PREFIX`. Falha no envio não apaga a cópia local e aparece no log como "Falha ao enviar backup para o armazenamento externo". O log também alerta quando o disco passa de 70%.

Para restaurar uma cópia externa: baixe o arquivo `.gz.enc` do bucket e rode `BACKUP_ENCRYPTION_KEY=... npm run db:decrypt-backup -- arquivo.gz.enc restaurado.db`; depois siga o procedimento de verificação e restauração abaixo. Guarde a `BACKUP_ENCRYPTION_KEY` também fora do Render, pois sem ela o backup externo não pode ser aberto.

## Verificação e restauração

Execute `npm run db:verify-backup -- caminho/do/backup.db`. Para restaurar: pare a API; preserve o banco atual; verifique a cópia; coloque-a em `DATABASE_PATH`; rode `npm run db:migrate`; inicie a API; valide `/ready`, login e dashboard. Nunca sobrescreva o banco com a API ativa. Faça um ensaio trimestral em ambiente separado.

## Saúde e alertas

- `/health` confirma o processo e `/ready` confirma acesso ao banco;
- Configurações → Saúde da operação mostra filas, falhas e sessões;
- um monitor externo deve consultar `/ready`;
- falha de backup ou entrega deve gerar alerta e investigação.

Antes da produção pública, siga `docs/RELEASE-PRODUCAO.md`. Em produção, a API recusa segredo curto, origem pública sem HTTPS e credenciais externas incompletas.

## Teste grátis: captcha e confirmação de e-mail

O cadastro público do teste grátis tem duas etapas antes de criar o ambiente:

1. **Captcha (Cloudflare Turnstile):** o botão "Enviar código de confirmação" só funciona depois da verificação anti-robô. Crie um widget em Cloudflare → Turnstile → Add widget, com os domínios `fidelizaplus.com.br` e `www.fidelizaplus.com.br` e modo *Managed*. Copie a *Site Key* para `TURNSTILE_SITE_KEY` e a *Secret Key* para `TURNSTILE_SECRET_KEY` no serviço `fideliza-plus-api` do Render. As duas devem ser configuradas juntas. Sem elas o captcha fica desligado, mas a confirmação por e-mail continua obrigatória.
2. **Código por e-mail:** a API envia um código de 6 dígitos (válido por 30 minutos, 5 tentativas) para o e-mail de acesso. O teste só é criado com o código correto. Depende de `RESEND_API_KEY` e `EMAIL_FROM`: sem e-mail configurado, ninguém consegue concluir o teste grátis.

Limites: 3 códigos por e-mail a cada 15 minutos e 10 por IP por hora, além de 1 teste por CNPJ e 3 por IP ao dia. O conteúdo do e-mail com o código é apagado do banco depois do envio.
