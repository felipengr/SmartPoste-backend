import argon2 from 'argon2';
import type { FastifyInstance, FastifyRequest } from 'fastify';
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

const listarSchema = z.object({
  // Por nome ("maria") ou por parte do CPF ("471.028" ou "471028")
  busca: z.string().trim().max(60).optional(),
});

const redefinirSenhaSchema = z.object({ novaSenha: z.string().min(8).max(128) });

// O gestor só vê o CPF mascarado (padrão LGPD): ***.471.028-**.
// Dá para diferenciar homônimos sem expor o número inteiro.
function mascararCpf(cpf: string) {
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

// Papel conferido no banco, não no token: quem deixou de ser gestor ainda teria
// um token dizendo "gestor" por até 30 dias
async function exigirGestor(request: FastifyRequest, acao: string) {
  const gestor = await prisma.usuario.findUnique({
    where: { id: request.user.sub },
    select: { id: true, papel: true, municipioId: true },
  });
  if (!gestor) throw sessaoExpirada();
  if (gestor.papel !== 'gestor') {
    throw new AppError(403, 'SEM_PERMISSAO', `Só gestores da prefeitura podem ${acao}.`);
  }
  return gestor;
}

export async function usuariosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.autenticar);

  app.post('/usuarios', async (request, reply) => {
    const gestor = await exigirGestor(request, 'cadastrar usuários');
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

  // Usuários do município do gestor, por ordem de nome (até 50; use a busca para achar alguém)
  app.get('/usuarios', async (request) => {
    const gestor = await exigirGestor(request, 'ver os usuários');
    const resultado = listarSchema.safeParse(request.query);
    if (!resultado.success) {
      throw new AppError(400, 'REQUISICAO_INVALIDA', 'Parâmetros da consulta inválidos.');
    }

    const busca = resultado.data.busca ?? '';
    const digitos = busca.replace(/\D/g, '');
    const porCpf = /^[\d.\-\s]+$/.test(busca) && digitos.length >= 3;
    const where: Prisma.UsuarioWhereInput = {
      municipioId: gestor.municipioId,
      ...(busca &&
        (porCpf
          ? { cpf: { contains: digitos } }
          : { nome: { contains: busca, mode: 'insensitive' } })),
    };

    const [usuarios, total] = await Promise.all([
      prisma.usuario.findMany({
        where,
        orderBy: { nome: 'asc' },
        take: 50,
        select: { id: true, nome: true, papel: true, cpf: true, criadoEm: true },
      }),
      prisma.usuario.count({ where }),
    ]);

    return {
      itens: usuarios.map(({ cpf, ...u }) => ({ ...u, cpfMascarado: mascararCpf(cpf) })),
      total,
    };
  });

  // "Esqueci minha senha": o gestor define uma senha nova para alguém do município dele
  app.patch('/usuarios/:id/senha', async (request, reply) => {
    const gestor = await exigirGestor(request, 'redefinir senhas');
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { novaSenha } = redefinirSenhaSchema.parse(request.body);

    if (id === gestor.id) {
      throw new AppError(
        403,
        'SEM_PERMISSAO',
        'Para trocar a sua própria senha, use Perfil → Alterar senha.',
      );
    }

    // De outro município responde igual a inexistente: não revela que a pessoa existe
    const alvo = await prisma.usuario.findFirst({
      where: { id, municipioId: gestor.municipioId },
      select: { id: true },
    });
    if (!alvo) throw new AppError(404, 'NAO_ENCONTRADA', 'Usuário não encontrado.');

    // Subir a versão da sessão desconecta a pessoa de todos os aparelhos
    await prisma.usuario.update({
      where: { id: alvo.id },
      data: { senhaHash: await argon2.hash(novaSenha), versaoSessao: { increment: 1 } },
    });

    return reply.status(204).send();
  });
}
