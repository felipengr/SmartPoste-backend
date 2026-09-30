import { buildApp } from './app.js';
import { env } from './env.js';
import { prisma } from './lib/prisma.js';

const app = await buildApp();

// Encerra conexões com o banco ao parar o servidor (Ctrl+C ou deploy)
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

await app.listen({ host: env.HOST, port: env.PORT });
