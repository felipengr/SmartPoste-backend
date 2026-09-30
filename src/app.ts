import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';

import { env } from './env.js';
import { registrarAutenticacao } from './lib/auth.js';
import { registrarTratamentoDeErros } from './lib/errors.js';
import { type EnviarFoto, enviarFotoCloudinary, TAMANHO_MAXIMO_FOTO } from './lib/fotos.js';
import { authRoutes, type LimitesLogin } from './routes/auth.js';
import { denunciasRoutes } from './routes/denuncias.js';
import { meRoutes } from './routes/me.js';
import { municipiosRoutes } from './routes/municipios.js';
import { usuariosRoutes } from './routes/usuarios.js';

declare module 'fastify' {
  interface FastifyInstance {
    enviarFoto: EnviarFoto;
  }
}

type Opcoes = {
  // Os testes trocam pelo falso, para não enviar fotos ao Cloudinary de verdade
  enviarFoto?: EnviarFoto;
  limitesLogin?: LimitesLogin;
};

// Nos testes, cada arquivo faz dezenas de logins seguidos do mesmo IP; o teste do
// limite passa os próprios números
const LIMITES_LOGIN: LimitesLogin =
  env.NODE_ENV === 'test'
    ? { porConta: Number.POSITIVE_INFINITY, porIp: Number.POSITIVE_INFINITY }
    : { porConta: 5, porIp: 20 };

// Monta a aplicação sem subir o servidor, para os testes usarem `app.inject()`
export async function buildApp({
  enviarFoto = enviarFotoCloudinary,
  limitesLogin = LIMITES_LOGIN,
}: Opcoes = {}) {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: 'info' },
  });

  // O app nativo não precisa de CORS; isto libera o app rodando no navegador (Expo web)
  await app.register(cors, { origin: env.NODE_ENV !== 'production' });

  // Formulário da nova denúncia: 1 foto de até 5 MB e poucos campos curtos.
  // Acima disso o envio é cortado antes de ser lido inteiro.
  await app.register(multipart, {
    limits: { fileSize: TAMANHO_MAXIMO_FOTO, files: 1, fields: 20, fieldSize: 2048, parts: 25 },
  });

  app.decorate('enviarFoto', enviarFoto);

  registrarTratamentoDeErros(app);
  await registrarAutenticacao(app);

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(municipiosRoutes, { prefix: '/v1' });
  await app.register(authRoutes, { prefix: '/v1', limites: limitesLogin });
  await app.register(meRoutes, { prefix: '/v1' });
  await app.register(usuariosRoutes, { prefix: '/v1' });
  await app.register(denunciasRoutes, { prefix: '/v1' });

  return app;
}
