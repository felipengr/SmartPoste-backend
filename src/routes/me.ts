import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { sessaoExpirada } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

const trocarSenhaSchema = z.object({
  senhaAtual: z.string().min(1),
  // Máximo evita que alguém mande um texto gigante só para ocupar o servidor com o hash
  novaSenha: z.string().min(8).max(128),
});

export async function meRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.autenticar);

  app.get('/me', async (request) => {
    const usuario = await prisma.usuario.findUnique({
      where: { id: request.user.sub },
      select: {
        id: true,
        nome: true,
        papel: true,
        municipio: { select: { id: true, nome: true, uf: true, estado: true } },
        _count: { select: { denuncias: true } },
      },
    });

    // Token válido de um usuário que foi removido
    if (!usuario) throw sessaoExpirada();

    const { _count, ...dados } = usuario;
    return { ...dados, estatisticas: { denuncias: _count.denuncias } };
  });

  app.patch('/me/senha', async (request, reply) => {
    const { senhaAtual, novaSenha } = trocarSenhaSchema.parse(request.body);

    const usuario = await prisma.usuario.findUnique({
      where: { id: request.user.sub },
      select: { senhaHash: true },
    });
    if (!usuario) throw sessaoExpirada();

    if (!(await argon2.verify(usuario.senhaHash, senhaAtual))) {
      // 403 e não 401: o app trata 401 como "sessão expirou" e voltaria para o login
      throw new AppError(403, 'SENHA_INCORRETA', 'A senha atual está incorreta.');
    }

    await prisma.usuario.update({
      where: { id: request.user.sub },
      data: { senhaHash: await argon2.hash(novaSenha) },
    });

    return reply.status(204).send();
  });
}
