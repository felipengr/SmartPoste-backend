import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // No Prisma 7 o seed só roda com `npm run db:seed` (não roda sozinho após migrate)
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // A CLI (migrate) usa esta URL. Em produção (Neon), a API usa a URL com pool
    // (DATABASE_URL) e as migrations precisam da conexão direta (DIRECT_URL).
    // Localmente só existe DATABASE_URL, que serve para os dois.
    url: process.env.DIRECT_URL || env('DATABASE_URL'),
  },
});
