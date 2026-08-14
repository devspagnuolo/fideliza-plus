# Operação do piloto

## Backup

Execute `npm run db:backup`. O arquivo será criado em `apps/api/backups/`, diretório ignorado pelo Git. Copie o backup para armazenamento seguro fora do computador do piloto.

## Restauração

1. pare a API;
2. preserve o banco atual em outro local;
3. copie o backup escolhido para o caminho configurado em `DATABASE_PATH`;
4. execute `npm run db:migrate`;
5. inicie a API e valide `GET /health` e o login piloto.

Nunca restaure um backup sobre um processo em execução. Faça um ensaio de restauração antes de usar dados reais.

## Antes da produção pública

- usar PostgreSQL gerenciado com backup automático e Row Level Security;
- configurar HTTPS, domínio e segredos em cofre;
- remover a senha piloto e cadastrar usuários reais;
- aprovar termos de uso, política de privacidade e encarregado LGPD;
- configurar logs centralizados, monitoramento e alertas;
- executar teste de restauração e revisão de segurança externa.

## Saúde e alertas

- `GET /health`: confirma que o processo está ativo e informa tempo de atividade;
- `GET /ready`: confirma que a API consegue consultar o banco;
- Configurações → Saúde da operação: mostra fila, falhas, sessões e alertas da empresa para usuários proprietários;
- falhas de entrega devem ser revisadas antes de reprocessar uma campanha;
- em produção, um monitor externo deve consultar `/ready` e alertar a equipe quando houver indisponibilidade.
