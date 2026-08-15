# Portais e assinaturas

O Fideliza+ possui três experiências isoladas, cada uma com sessão e autorização próprias.

## 1. Painel da empresa

- URL pública: `https://fideliza-plus-web.onrender.com`
- Público: proprietários e funcionários do varejista.
- Finalidade: clientes, vendas, campanhas, fidelidade, integrações, equipe e indicadores da empresa.

## 2. Portal do consumidor

- Padrão da URL: `https://fideliza-plus-web.onrender.com/cliente/{slug-da-empresa}`
- Piloto: `https://fideliza-plus-web.onrender.com/cliente/vivi-moda-plus-size`
- Público: consumidores da empresa identificados por CPF.
- Finalidade: adesão ao programa, login, saldo, extrato e catálogo de benefícios.

O CPF é único dentro de cada empresa. O consumidor só começa a participar depois de aceitar os termos e concluir a adesão. Sua sessão não concede acesso ao painel da empresa nem ao painel administrativo da plataforma.

## 3. Fideliza+ Admin

- URL: `https://fideliza-plus-web.onrender.com/admin`
- Público: proprietário e administradores internos do Fideliza+.
- Finalidade: visão consolidada de empresas, quantidade de usuários e consumidores, assinaturas, planos, situação de cobrança e MRR.

No Render, configure `PLATFORM_ADMIN_EMAIL` e `PLATFORM_ADMIN_PASSWORD`. No primeiro login válido, a conta administrativa inicial é criada. A senha deve ter no mínimo 10 caracteres; use uma senha exclusiva e forte.

## Assinaturas

Esta versão mantém o cadastro e a gestão dos planos dentro do Fideliza+ Admin. Os estados disponíveis são: teste, ativa, inadimplente, suspensa e cancelada. O valor mensal e o próximo vencimento podem ser administrados por empresa.

A cobrança automática ainda não movimenta dinheiro. A próxima etapa é conectar um provedor de pagamentos, receber webhooks e automatizar ativação, inadimplência, suspensão, notas e histórico financeiro.

## Pendências antes da abertura pública

- verificação do telefone do consumidor por código temporário;
- recuperação de senha específica do consumidor e do administrador da plataforma;
- aceite versionado de termos e política de privacidade;
- provedor de pagamento e conciliação de cobranças;
- trilha de auditoria dedicada às mudanças de assinatura;
- suporte a múltiplos administradores da plataforma com 2FA;
- personalização do portal do consumidor por empresa e domínio próprio.
