import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

// Gestor e cidadão próprios do teste, e CPFs válidos para cadastrar; tudo apagado no final
const CPF_GESTOR = '00000000353';
const CPF_CIDADAO = '00000000434';
const CPF_NOVO = '52998224725'; // 529.982.247-25
const CPF_NOVO_2 = '98765432100'; // 987.654.321-00
const SENHA = 'senha-de-teste';
const TODOS = [CPF_GESTOR, CPF_CIDADAO, CPF_NOVO, CPF_NOVO_2];

let app: FastifyInstance;
let tokenGestor: string;
let tokenCidadao: string;

beforeAll(async () => {
  app = await buildApp();
  await prisma.usuario.deleteMany({ where: { cpf: { in: TODOS } } });

  const senhaHash = await argon2.hash(SENHA);
  await prisma.usuario.createMany({
    data: [
      {
        municipioId: 'piracaia',
        cpf: CPF_GESTOR,
        nome: 'Gestor do Teste',
        papel: 'gestor',
        senhaHash,
      },
      {
        municipioId: 'piracaia',
        cpf: CPF_CIDADAO,
        nome: 'Cidadão do Teste',
        papel: 'cidadao',
        senhaHash,
      },
    ],
  });
  tokenGestor = await login(CPF_GESTOR);
  tokenCidadao = await login(CPF_CIDADAO);
});

// Cada teste começa sem os usuários que ele mesmo cadastra
beforeEach(async () => {
  await prisma.usuario.deleteMany({ where: { cpf: { in: [CPF_NOVO, CPF_NOVO_2] } } });
});

afterAll(async () => {
  await prisma.usuario.deleteMany({ where: { cpf: { in: TODOS } } });
  await app.close();
  await prisma.$disconnect();
});

async function login(cpf: string, senha = SENHA) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { municipioId: 'piracaia', cpf, senha },
  });
  return res.json().token as string;
}

function cadastrar(corpo: Record<string, unknown>, token: string | null = tokenGestor) {
  return app.inject({
    method: 'POST',
    url: '/v1/usuarios',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: corpo,
  });
}

const novoUsuario = {
  nome: 'Maria Souza',
  cpf: '529.982.247-25',
  senhaInicial: 'senha-inicial',
  papel: 'cidadao',
};

describe('POST /v1/usuarios', () => {
  it('gestor cadastra um cidadão: 201 sem senha nem CPF, e ele consegue logar', async () => {
    const res = await cadastrar(novoUsuario);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: expect.any(String),
      nome: 'Maria Souza',
      papel: 'cidadao',
      municipio: { id: 'piracaia', nome: 'Piracaia', uf: 'SP', estado: 'São Paulo' },
    });
    expect(res.body).not.toContain(CPF_NOVO);
    expect(res.body).not.toContain('senha');

    // Guardado só com os dígitos, e a senha inicial funciona no login
    expect(await login(CPF_NOVO, 'senha-inicial')).toEqual(expect.any(String));
  });

  it('cria sempre no município do gestor, mesmo se o corpo mandar outro', async () => {
    const res = await cadastrar({ ...novoUsuario, municipioId: 'outra-cidade' });

    expect(res.statusCode).toBe(201);
    expect(res.json().municipio.id).toBe('piracaia');
  });

  it('gestor pode cadastrar outro gestor', async () => {
    const res = await cadastrar({ ...novoUsuario, cpf: '98765432100', papel: 'gestor' });

    expect(res.statusCode).toBe(201);
    expect(res.json().papel).toBe('gestor');
  });

  it('CPF já cadastrado no município responde 409', async () => {
    await cadastrar(novoUsuario);
    const res = await cadastrar({ ...novoUsuario, nome: 'Outra Pessoa', cpf: '52998224725' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      erro: {
        codigo: 'CPF_JA_CADASTRADO',
        mensagem: 'Já existe um usuário com este CPF no município.',
      },
    });
  });

  it('dois cadastros simultâneos com o mesmo CPF: um 201 e um 409', async () => {
    const respostas = await Promise.all([cadastrar(novoUsuario), cadastrar(novoUsuario)]);

    expect(respostas.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });

  it('cidadão não pode cadastrar: 403', async () => {
    const res = await cadastrar(novoUsuario, tokenCidadao);

    expect(res.statusCode).toBe(403);
    expect(res.json().erro.codigo).toBe('SEM_PERMISSAO');
  });

  it('papel é conferido no banco: gestor rebaixado perde o acesso com o mesmo token', async () => {
    await prisma.usuario.update({
      where: { municipioId_cpf: { municipioId: 'piracaia', cpf: CPF_GESTOR } },
      data: { papel: 'cidadao' },
    });
    try {
      const res = await cadastrar(novoUsuario);
      expect(res.statusCode).toBe(403);
    } finally {
      await prisma.usuario.update({
        where: { municipioId_cpf: { municipioId: 'piracaia', cpf: CPF_GESTOR } },
        data: { papel: 'gestor' },
      });
    }
  });

  it('sem token responde 401', async () => {
    const res = await cadastrar(novoUsuario, null);

    expect(res.statusCode).toBe(401);
  });

  it.each([
    ['dígito verificador errado', '529.982.247-26'],
    ['todos os dígitos iguais', '111.111.111-11'],
  ])('CPF inválido (%s) responde 422', async (_caso, cpf) => {
    const res = await cadastrar({ ...novoUsuario, cpf });

    expect(res.statusCode).toBe(422);
    expect(res.json().erro.campos).toEqual({ cpf: 'CPF inválido' });
  });

  it('campos inválidos respondem 422 com cada um', async () => {
    const res = await cadastrar({
      nome: 'Al',
      cpf: '123',
      senhaInicial: '1234567',
      papel: 'admin',
    });

    expect(res.statusCode).toBe(422);
    expect(Object.keys(res.json().erro.campos).sort()).toEqual([
      'cpf',
      'nome',
      'papel',
      'senhaInicial',
    ]);
  });
});
