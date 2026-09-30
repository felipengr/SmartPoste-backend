import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import type { Papel } from '../generated/prisma/client.js';
import { AppError } from './errors.js';
import { prisma } from './prisma.js';

// Dados guardados dentro do token (nada sensível: o token é só assinado, não criptografado).
// `versao` é a versão de sessão do usuário quando o token foi emitido.
export type UsuarioToken = { sub: string; municipioId: string; papel: Papel; versao: number };

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

// Também usado quando o token é válido mas o usuário não existe mais
export function sessaoExpirada() {
  return new AppError(401, 'NAO_AUTENTICADO', 'Sua sessão expirou. Faça login novamente.');
}

type DadosDoToken = { id: string; municipioId: string; papel: Papel; versaoSessao: number };

export function emitirToken(app: FastifyInstance, usuario: DadosDoToken) {
  return app.jwt.sign({
    sub: usuario.id,
    municipioId: usuario.municipioId,
    papel: usuario.papel,
    versao: usuario.versaoSessao,
  });
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
      throw sessaoExpirada();
    }

    // Token com assinatura válida, mas de um usuário removido ou emitido antes da
    // última troca de senha (a versão de sessão subiu): não vale mais
    const usuario = await prisma.usuario.findUnique({
      where: { id: request.user.sub },
      select: { versaoSessao: true },
    });
    if (!usuario || usuario.versaoSessao !== request.user.versao) throw sessaoExpirada();
  });
}
