# Portais e assinaturas

O Fideliza+ possui três experiências isoladas, cada uma com sessão e autorização próprias.

## 1. Painel da empresa

- URL pública oficial: `https://fidelizaplus.com.br`
- Endereço alternativo: `https://www.fidelizaplus.com.br`
- Público: proprietários e funcionários do varejista.
- Finalidade: clientes, vendas, campanhas, fidelidade, integrações, equipe e indicadores da empresa.

## 2. Portal do consumidor

- Padrão da URL: `https://fidelizaplus.com.br/cliente/{slug-da-empresa}`
- Piloto: `https://fidelizaplus.com.br/cliente/vivi-moda-plus-size`
- Público: consumidores da empresa identificados por CPF.
- Finalidade: adesão ao programa, login, saldo, extrato e catálogo de benefícios.

O CPF é único dentro de cada empresa. O consumidor só começa a participar depois de aceitar os termos e concluir a adesão. Sua sessão não concede acesso ao painel da empresa nem ao painel administrativo da plataforma.

## 3. Fideliza+ Admin

- URL: `https://fidelizaplus.com.br/admin`
- Público: proprietário e administradores internos do Fideliza+.
- Finalidade: visão consolidada de empresas, quantidade de usuários e consumidores, assinaturas, planos, situação de cobrança e MRR.

No Render, configure `PLATFORM_ADMIN_EMAIL` e `PLATFORM_ADMIN_PASSWORD`. No primeiro login válido, a conta administrativa inicial é criada. A senha deve ter no mínimo 10 caracteres; use uma senha exclusiva e forte.

### Papéis da equipe da plataforma

A conta inicial é `super_admin`. Os demais membros são criados em **Usuários › Equipe da plataforma**, sempre por um Super Admin, e precisam ativar o MFA no primeiro acesso em produção.

| Papel | Pode fazer por padrão |
| --- | --- |
| Super Admin (`super_admin`) | Tudo, inclusive gerenciar a equipe e a matriz de permissões. Não pode ser restringido. |
| Financeiro (`finance`) | Leitura geral, assinaturas, faturas, cobrança, cupons, Asaas, planos, relatórios e exportações CSV. |
| Suporte (`support`) | Leitura geral, cadastro de empresas e seus usuários, chamados, ajuste de pontos e reprocessamento de vendas. |
| Operações (`operations`) | Leitura geral, jobs, filas, agendamentos, integrações, monitoramento, incidentes e leitura de segurança. |
| Somente leitura (`viewer`) | Apenas visualizar dashboards, empresas, finanças, planos, suporte e monitoramento. |

O Super Admin ajusta esses padrões em **Usuários › Permissões**; a mudança vale na próxima requisição. Reiniciar a base de homologação (`companies.reset`) fica desligado para todos os papéis além do Super Admin, e `admins.manage` nunca é delegável. A plataforma impede remover o último Super Admin ativo e impede que alguém altere o próprio papel. Trocar papel, desativar ou redefinir senha encerra as sessões da pessoa. Toda alteração fica em `platform_audit_logs`.

## Assinaturas

Esta versão mantém o cadastro e a gestão dos planos dentro do Fideliza+ Admin. Os estados disponíveis são: teste, ativa, inadimplente, suspensa e cancelada. O valor mensal e o próximo vencimento podem ser administrados por empresa.

A cobrança automática ainda não movimenta dinheiro. A próxima etapa é conectar um provedor de pagamentos, receber webhooks e automatizar ativação, inadimplência, suspensão, notas e histórico financeiro.

## Pendências antes da abertura pública

- realizar revisão jurídica final dos documentos públicos em `/privacidade`, `/termos`, `/termos-programa` e `/cookies`;

- verificação do telefone do consumidor por código temporário;
- recuperação de senha específica do consumidor e do administrador da plataforma;
- provedor de pagamento e conciliação de cobranças;
- trilha de auditoria dedicada às mudanças de assinatura;
- suporte a múltiplos administradores da plataforma com 2FA;
- personalização do portal do consumidor por empresa e domínio próprio.
