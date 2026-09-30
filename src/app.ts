import cors from '@fastify/cors';
import Fastify from 'fastify';

import { env } from './env.js';
import { registrarAutenticacao } from './lib/auth.js';
import { registrarTratamentoDeErros } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { municipiosRoutes } from './routes/municipios.js';

// Monta a aplicação sem subir o servidor, para os testes usarem `app.inject()`
export async function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: 'info' },
  });

  // O app nativo não precisa de CORS; isto libera o app rodando no navegador (Expo web)
  await app.register(cors, { origin: env.NODE_ENV !== 'production' });

  registrarTratamentoDeErros(app);
  await registrarAutenticacao(app);

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(municipiosRoutes, { prefix: '/v1' });
  await app.register(authRoutes, { prefix: '/v1' });
  await app.register(meRoutes, { prefix: '/v1' });

  return app;
}
