# Smart Poste — Backend

API do Smart Poste: cidadãos denunciam postes e fios danificados pelo app, e a prefeitura acompanha e atualiza o status.
Projeto Integrador — UNIVESP.

- **App (front):** [SmartPost-frontend](https://github.com/felipengr/SmartPost-frontend)
- **Contrato da API:** [`docs/API.md` no repositório do app](https://github.com/felipengr/SmartPost-frontend/blob/main/docs/API.md) — a referência de rotas, formatos e erros.

## Stack

Node.js 24 · TypeScript · Fastify · PostgreSQL · Prisma 7 · zod · argon2 · Vitest · Biome

## Como rodar

Pré-requisitos: **Node 24** (há um `.nvmrc`), **Docker Desktop** aberto e uma conta grátis no **Cloudinary** (fotos das denúncias; crie uma API Key própria em Settings → API Keys e preencha as variáveis `CLOUDINARY_*` do `.env`).

```bash
npm install                 # também gera o client do Prisma
cp .env.example .env        # variáveis locais — troque o JWT_SECRET (comando no próprio arquivo)
npm run db:up               # sobe o Postgres no Docker (porta 5433)
npm run db:migrate          # aplica as migrations (cria as tabelas)
npm run db:seed             # município Piracaia + usuários de teste
npm run dev                 # API em http://localhost:3333
```

Teste: `http://localhost:3333/v1/municipios`.

### Usuários de teste (seed)

| Papel | CPF | Senha |
|---|---|---|
| cidadão | `111.111.111-11` | `smartposte` |
| gestor | `222.222.222-22` | `smartposte` |

### Acessar pelo celular (Expo Go)

A API escuta em `0.0.0.0`, então o celular na mesma rede Wi-Fi acessa pelo IP do computador — ex.: `http://192.168.0.10:3333`.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | API com recarga automática |
| `npm test` | Testes (precisa do banco rodando e com seed) |
| `npm run check` | Lint + formatação (Biome) |
| `npm run typecheck` | Checagem de tipos |
| `npm run build` / `npm start` | Build de produção em `dist/` e execução |
| `npm run db:migrate` | Aplica as migrations pendentes no banco local |
| `npx prisma migrate dev --name <descricao>` | Cria uma migration após mudar `prisma/schema.prisma` (no PowerShell, `npm run db:migrate -- --name` perde o `--name`) |
| `npm run db:reset` | Apaga o banco local, recria e roda o seed |
| `npm run db:studio` | Interface visual do banco |
| `npm run release` | Sobe a versão e atualiza o `CHANGELOG.md` |
| `npm run db:migrate:producao` | Aplica as migrations no banco de produção (lê `.env.producao`) |
| `npm run db:seed:producao` | Cria Piracaia e o primeiro gestor em produção (lê `.env.producao`) |

## Produção

API no **Render** e banco no **Neon** (ambos na região US East / Virginia, lado a lado).

**Variáveis no painel do Render** (nunca no git nem no app):

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | URL do Neon **com** pool (`...-pooler...`) |
| `DIRECT_URL` | URL do Neon **sem** pool (usada pelas migrations no build) |
| `JWT_SECRET` | novo, diferente do de desenvolvimento |
| `CLOUDINARY_*` | chave própria de produção |
| `TRUST_PROXY` | proxies confiáveis para o IP real (veja abaixo) |

**Build:** `npm ci --include=dev && npm run build && npx prisma migrate deploy` · **Start:** `npm start` · **Health check:** `/health`

**Primeira vez:** crie um `.env.producao` local (fora do git) com `DIRECT_URL`, `GESTOR_CPF`, `GESTOR_NOME` e `GESTOR_SENHA` (12+ caracteres) e rode `npm run db:migrate:producao` e `npm run db:seed:producao`. Depois, apague o arquivo.

### `TRUST_PROXY` no Render

O caminho de uma requisição é `cliente → Cloudflare → balanceador do Render (10.x) → proxy local (127.0.0.1) → API`. Para o limite de login por IP ver o IP real (e ninguém conseguir inventar um no `X-Forwarded-For`), a API precisa confiar nesses três saltos, e só neles:

```
127.0.0.1,10.0.0.0/8,<faixas IPv4 de https://www.cloudflare.com/ips-v4/>,<faixas IPv6 de https://www.cloudflare.com/ips-v6/>
```

Separados por vírgula, sem espaços. Para conferir: chame `GET /v1/municipios?teste=1` com e sem o header `X-Forwarded-For: 6.6.6.6` e veja no log do Render se o `remoteAddress` das duas é o seu IP público. Se a Cloudflare mudar as faixas, só o limite por IP perde precisão; o limite por conta (CPF) continua valendo.

## Estrutura

```
prisma/
  schema.prisma     modelo do banco
  migrations/       histórico de mudanças no banco (vai para o git)
  seed.ts           dados iniciais de desenvolvimento
src/
  server.ts         sobe o servidor
  app.ts            monta o Fastify (usado também pelos testes)
  env.ts            variáveis de ambiente validadas com zod
  lib/              prisma, formato de erros
  routes/           uma rota (ou grupo) por arquivo
  generated/        client do Prisma — gerado, não vai para o git
test/               testes com Vitest (app.inject)
```

## Convenções

- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`…), validados pelo commitlint. O Biome roda nos arquivos do commit.
- **Branches:** uma por tarefa (`feat/login`, `fix/...`) a partir da `main`.
- **Erros:** sempre no formato `{ "erro": { "codigo", "mensagem", "campos?" } }`. Nas rotas, lance `new AppError(status, codigo, mensagem)`; erros do zod viram 422 automaticamente.
- **Scripts de instalação:** o npm 12 bloqueia scripts de pacotes por padrão. Os liberados estão em `allowScripts` no `package.json`, fixados por versão — ao atualizar o Prisma, rode `npm install-scripts approve prisma @prisma/engines`.
