# Homologação

## Objetivo

Executar a mesma versão em qualquer máquina compatível com Docker, com dados persistentes, healthchecks e reinício automático.

## Iniciar

1. copie `.env.example` para `.env`;
2. substitua `SESSION_SECRET` por uma chave aleatória com no mínimo 32 caracteres;
3. execute `npm run docker:up`;
4. aguarde os serviços ficarem saudáveis;
5. acesse `http://localhost:8080`.

Para acompanhar: `docker compose ps` e `docker compose logs -f`. Para parar sem apagar dados: `npm run docker:down`.

## Critérios de homologação

- `http://localhost:3333/health` retorna `status: ok`;
- `http://localhost:8080/healthz` retorna `ok`;
- login piloto funciona;
- cadastro de cliente, venda e pontos aparecem no dashboard;
- resgate reduz saldo e cria extrato;
- campanha permanece como rascunho;
- reiniciar os contêineres preserva os dados.

## CI

O workflow `.github/workflows/ci.yml` executa em push e pull request:

- instalação reproduzível via `npm ci`;
- testes automatizados;
- build de produção;
- auditoria de vulnerabilidades altas;
- build independente das imagens web e API.

O deploy público só deve ocorrer após a CI verde e a configuração dos itens de produção descritos em `OPERACAO.md`.
