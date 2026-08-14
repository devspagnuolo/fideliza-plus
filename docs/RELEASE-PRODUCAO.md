# Checklist de liberação para produção

Uma versão só pode receber o status **liberada** quando todos os itens obrigatórios tiverem responsável e evidência.

## Qualidade técnica

- [ ] testes e build aprovados no mesmo commit publicado;
- [ ] `npm run smoke` aprovado contra o endereço publicado;
- [ ] imagens Docker aprovadas pelo pipeline;
- [ ] migração homologada e plano de reversão registrado;
- [ ] `/health` e `/ready` monitorados externamente;
- [ ] logs e alertas sem segredos ou dados pessoais desnecessários.

## Segurança e dados

- [ ] HTTPS e domínio oficial ativos;
- [ ] segredos exclusivos no cofre da hospedagem;
- [ ] credenciais piloto removidas e 2FA dos proprietários ativo;
- [ ] permissões revisadas e documentos LGPD aprovados;
- [ ] revisão de segurança independente antes da abertura pública.

## Continuidade

- [ ] backup automático persistente e segunda cópia criptografada externa;
- [ ] restauração real ensaiada em ambiente separado;
- [ ] meta inicial: perda máxima de 24 horas e recuperação em até 4 horas;
- [ ] responsável e canal de incidente definidos.

## Negócio e fornecedores

- [ ] Vivi Moda homologou clientes, vendas, pontos, resgate e dashboard;
- [ ] e-mail e WhatsApp aprovados antes do envio real;
- [ ] Bling validado em conta real sem duplicar vendas ou pontos;
- [ ] custos, limites e termos dos provedores aceitos.

Itens não marcados impedem produção pública, mas não desenvolvimento ou homologação controlada.
