import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { Prisma } from '../generated/prisma/client.js';
import { sessaoExpirada } from '../lib/auth.js';
import { cpfValido } from '../lib/cpf.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

const criarUsuarioSchema = z.object({
  nome: z.string().trim().min(3).max(120),
  cpf: cpfValido,
  senhaInicial: z.string().min(8).max(128),
  papel: z.enum(['cidadao', 'gestor']),
});

export async function usuariosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.autenticar);

  app.post('/usuarios', async (request, reply) => {
    // Papel conferido no banco, não no token: quem deixou de ser gestor
    // ainda teria um token dizendo "gestor" por até 30 dias
    const gestor = await prisma.usuario.findUnique({
      where: { id: request.user.sub },
      select: { papel: true, municipioId: true },
    });
    if (!gestor) throw sessaoExpirada();
    if (gestor.papel !== 'gestor') {
      throw new AppError(
        403,
        'SEM_PERMISSAO',
        'Só gestores da prefeitura podem cadastrar usuários.',
      );
    }

    const { nome, cpf, senhaInicial, papel } = criarUsuarioSchema.parse(request.body);

    try {
      const usuario = await prisma.usuario.create({
        // Sempre no município do gestor; o corpo da requisição não escolhe a cidade
        data: {
          municipioId: gestor.municipioId,
          nome,
          cpf,
          papel,
          senhaHash: await argon2.hash(senhaInicial),
        },
        select: {
          id: true,
          nome: true,
          papel: true,
          municipio: { select: { id: true, nome: true, uf: true, estado: true } },
        },
      });
      return reply.status(201).send(usuario);
    } catch (erro) {
      // Violação do único (municipio_id, cpf), inclusive em dois cadastros simultâneos
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new AppError(
          409,
          'CPF_JA_CADASTRADO',
          'Já existe um usuário com este CPF no município.',
        );
      }
      throw erro;
    }
  });
}
