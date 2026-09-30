API do Smart Poste em Node 24 + TypeScript (ESM) + Fastify 5 + Prisma 7 (PostgreSQL) + zod 4. Leia o README.md para estrutura e scripts.

## Fonte de verdade

O contrato da API fica em `docs/API.md` no repositório do app (`../SmartPost-frontend/docs/API.md`). Toda rota deve seguir esse contrato; se precisar mudá-lo, atualize o arquivo no repositório do app também.

## Regras

- **Prisma 7 mudou muito** — não confie em exemplos antigos. O client é gerado em `src/generated/prisma` (import de `../generated/prisma/client.js`), a conexão usa `@prisma/adapter-pg`, a config fica em `prisma.config.ts` e o seed **não** roda sozinho após migrate (`npm run db:seed`). Docs: https://www.prisma.io/docs/orm/v7
- Imports relativos usam extensão `.js` (ESM `nodenext`).
- Valide entradas com zod (`schema.parse(request.body)`); o handler global transforma `ZodError` em 422. Erros esperados: `throw new AppError(status, codigo, mensagem)` de `src/lib/errors.ts`.
- Nunca devolver `senhaHash` nem CPF nas respostas. Nunca expor quem criou uma denúncia no feed.
- Mudou `prisma/schema.prisma`? Rode `npx prisma migrate dev --name <descricao>` (no PowerShell, `npm run db:migrate -- --name` perde o `--name` e trava esperando input) e versione a pasta `prisma/migrations`.

## Antes de dar uma tarefa como pronta

```bash
npm run check && npm run typecheck && npm test
```

Os testes precisam do Postgres rodando (`npm run db:up`) e com seed.

## Git

Conventional Commits em português, validados pelo commitlint (husky). Uma branch por tarefa a partir da `main`.
