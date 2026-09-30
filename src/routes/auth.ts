import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { emitirToken } from '../lib/auth.js';
import { cpfDigitos } from '../lib/cpf.js';
import { AppError } from '../lib/errors.js';
import { LimiteDeTentativas } from '../lib/limite.js';
import { prisma } from '../lib/prisma.js';

const loginSchema = z.object({
  municipioId: z.string().min(1),
  cpf: cpfDigitos,
  senha: z.string().min(1),
});

// Hash de uma senha qualquer, usado quando o CPF não existe: assim a resposta demora
// o mesmo que uma senha errada e não dá para descobrir quais CPFs estão cadastrados.
const hashFalso = await argon2.hash('usuario-inexistente');

// Tentativas de login por minuto
export type LimitesLogin = { porConta: number; porIp: number };

export async function authRoutes(app: FastifyInstance, { limites }: { limites: LimitesLogin }) {
  // Por conta: impede testar muitas senhas no mesmo CPF, mesmo trocando de IP.
  // Por IP: impede testar uma senha comum em muitos CPFs.
  const porConta = new LimiteDeTentativas(limites.porConta, 60_000);
  const porIp = new LimiteDeTentativas(limites.porIp, 60_000);

  app.post('/auth/login', async (request, reply) => {
    const { municipioId, cpf, senha } = loginSchema.parse(request.body);

    const esperar = porIp.registrar(request.ip) || porConta.registrar(`${municipioId}:${cpf}`);
    if (esperar > 0) {
      reply.header('retry-after', String(esperar));
      throw new AppError(
        429,
        'MUITAS_TENTATIVAS',
        `Muitas tentativas de login. Tente de novo em ${esperar} segundos.`,
      );
    }

    const usuario = await prisma.usuario.findUnique({
      where: { municipioId_cpf: { municipioId, cpf } },
      select: {
        id: true,
        nome: true,
        papel: true,
        senhaHash: true,
        versaoSessao: true,
        municipio: { select: { id: true, nome: true, uf: true, estado: true } },
      },
    });

    const senhaConfere = await argon2.verify(usuario?.senhaHash ?? hashFalso, senha);

    if (!usuario || !senhaConfere) {
      throw new AppError(401, 'CREDENCIAIS_INVALIDAS', 'CPF ou senha incorretos.');
    }

    const token = await emitirToken(app, { ...usuario, municipioId: usuario.municipio.id });

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
