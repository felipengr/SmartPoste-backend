import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import type { Papel } from '../generated/prisma/client.js';
import { AppError } from './errors.js';

// Dados guardados dentro do token (nada sensível: o token é só assinado, não criptografado)
export type UsuarioToken = { sub: string; municipioId: string; papel: Papel };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: UsuarioToken;
    user: UsuarioToken;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    // Use em rotas protegidas: { onRequest: [app.autenticar] }
    autenticar: (request: FastifyRequest) => Promise<void>;
  }
}

export async function registrarAutenticacao(app: FastifyInstance) {
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    // Fixa o algoritmo: impede aceitar tokens assinados de outro jeito
    sign: { algorithm: 'HS256', expiresIn: '30d' },
    verify: { algorithms: ['HS256'] },
  });

  app.decorate('autenticar', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      // Sem token, token adulterado ou expirado: mesma resposta
      throw new AppError(401, 'NAO_AUTENTICADO', 'Sua sessão expirou. Faça login novamente.');
    }
  });
}
