# Operação do piloto

## Backup automático e manual

Ative `AUTO_BACKUP_ENABLED=true` para gerar uma cópia verificada ao iniciar a API e depois no intervalo definido por `BACKUP_INTERVAL_HOURS`. A retenção combina idade (`BACKUP_RETENTION_DAYS`) e quantidade (`BACKUP_MAX_FILES`). No Docker, mantenha `BACKUP_DIRECTORY` dentro de `/data`.

Para uma cópia manual, execute `npm run db:backup`. O processo só informa sucesso depois de abrir o arquivo, verificar sua integridade e confirmar as tabelas essenciais. Mantenha outra cópia criptografada fora do servidor.

## Verificação e restauração

Execute `npm run db:verify-backup -- caminho/do/backup.db`. Para restaurar: pare a API; preserve o banco atual; verifique a cópia; coloque-a em `DATABASE_PATH`; rode `npm run db:migrate`; inicie a API; valide `/ready`, login e dashboard. Nunca sobrescreva o banco com a API ativa. Faça um ensaio trimestral em ambiente separado.

## Saúde e alertas

- `/health` confirma o processo e `/ready` confirma acesso ao banco;
- Configurações → Saúde da operação mostra filas, falhas e sessões;
- um monitor externo deve consultar `/ready`;
- falha de backup ou entrega deve gerar alerta e investigação.

Antes da produção pública, siga `docs/RELEASE-PRODUCAO.md`. Em produção, a API recusa segredo curto, origem pública sem HTTPS e credenciais externas incompletas.
