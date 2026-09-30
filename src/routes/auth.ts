import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { cpfDigitos } from '../lib/cpf.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

const loginSchema = z.object({
  municipioId: z.string().min(1),
  cpf: cpfDigitos,
  senha: z.string().min(1),
});

// Hash de uma senha qualquer, usado quando o CPF não existe: assim a resposta demora
// o mesmo que uma senha errada e não dá para descobrir quais CPFs estão cadastrados.
const hashFalso = await argon2.hash('usuario-inexistente');

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request) => {
    const { municipioId, cpf, senha } = loginSchema.parse(request.body);

    const usuario = await prisma.usuario.findUnique({
      where: { municipioId_cpf: { municipioId, cpf } },
      select: {
        id: true,
        nome: true,
        papel: true,
        senhaHash: true,
        municipio: { select: { id: true, nome: true, uf: true, estado: true } },
      },
    });

    const senhaConfere = await argon2.verify(usuario?.senhaHash ?? hashFalso, senha);

    if (!usuario || !senhaConfere) {
      throw new AppError(401, 'CREDENCIAIS_INVALIDAS', 'CPF ou senha incorretos.');
    }

    const token = await app.jwt.sign({
      sub: usuario.id,
      municipioId: usuario.municipio.id,
      papel: usuario.papel,
    });

    return {
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        papel: usuario.papel,
        municipio: usuario.municipio,
      },
    };
  });
}
