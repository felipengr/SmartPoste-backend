import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

// Duas cidades só do teste: na primeira, dois gestores e dois moradores; na outra,
// um gestor e um morador, para conferir que ninguém enxerga nem mexe na outra cidade
const CIDADE = 'teste-gestao';
const OUTRA_CIDADE = 'teste-gestao-2';
const SENHA = 'senha-de-teste';

let app: FastifyInstance;
const ids: Record<string, string> = {};

const pessoas = [
  ['gestorA', CIDADE, '00000000191', 'Gestora Ana', 'gestor'],
  ['gestorB', CIDADE, '00000000272', 'Gestor Bruno', 'gestor'],
  ['maria', CIDADE, '52998224725', 'Maria Aparecida', 'cidadao'],
  ['jose', CIDADE, '98765432100', 'José da Silva', 'cidadao'],
  ['gestorFora', OUTRA_CIDADE, '00000000353', 'Gestor de Fora', 'gestor'],
  ['moradorFora', OUTRA_CIDADE, '00000000434', 'Morador de Fora', 'cidadao'],
] as const;

beforeAll(async () => {
  app = await buildApp();
  await limpar();
  for (const id of [CIDADE, OUTRA_CIDADE]) {
    await prisma.municipio.create({
      data: {
        id,
        nome: id,
        uf: 'SP',
        estado: 'São Paulo',
        prefixoProtocolo: id.toUpperCase().slice(-2),
      },
    });
  }
  const senhaHash = await argon2.hash(SENHA);
  for (const [chave, municipioId, cpf, nome, papel] of pessoas) {
    const u = await prisma.usuario.create({ data: { municipioId, cpf, nome, papel, senhaHash } });
    ids[chave] = u.id;
  }
});

afterAll(async () => {
  await limpar();
  await app.close();
  await prisma.$disconnect();
});

async function limpar() {
  const cidades = { in: [CIDADE, OUTRA_CIDADE] };
  await prisma.usuario.deleteMany({ where: { municipioId: cidades } });
  await prisma.municipio.deleteMany({ where: { id: cidades } });
}

async function login(chave: (typeof pessoas)[number][0], senha = SENHA) {
  const pessoa = pessoas.find(([c]) => c === chave);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { municipioId: pessoa?.[1], cpf: pessoa?.[2], senha },
  });
  return res;
}

async function token(chave: (typeof pessoas)[number][0]) {
  return (await login(chave)).json().token as string;
}

function listar(tokenUsado: string, busca?: string) {
  return app.inject({
    method: 'GET',
    url: `/v1/usuarios${busca === undefined ? '' : `?busca=${encodeURIComponent(busca)}`}`,
    headers: { authorization: `Bearer ${tokenUsado}` },
  });
}

function redefinir(tokenUsado: string, id: string, novaSenha: string) {
  return app.inject({
    method: 'PATCH',
    url: `/v1/usuarios/${id}/senha`,
    headers: { authorization: `Bearer ${tokenUsado}` },
    payload: { novaSenha },
  });
}

describe('GET /v1/usuarios', () => {
  it('gestor vê só os usuários da cidade dele, por nome, com CPF mascarado', async () => {
    const res = await listar(await token('gestorA'));

    expect(res.statusCode).toBe(200);
    const { itens, total } = res.json();
    expect(total).toBe(4);
    expect(itens.map((u: { nome: string }) => u.nome)).toEqual([
      'Gestor Bruno',
      'Gestora Ana',
      'José da Silva',
      'Maria Aparecida',
    ]);
    expect(itens.find((u: { nome: string }) => u.nome === 'Maria Aparecida')).toEqual({
      id: ids.maria,
      nome: 'Maria Aparecida',
      papel: 'cidadao',
      cpfMascarado: '***.982.247-**',
      criadoEm: expect.any(String),
    });
    // Nunca o CPF completo nem a senha, e nada da outra cidade
    expect(res.body).not.toContain('52998224725');
    expect(res.body).not.toContain('senhaHash');
    expect(res.body).not.toContain('Morador de Fora');
  });

  it.each([
    ['nome, sem diferenciar maiúsculas', 'maria', ['Maria Aparecida']],
    ['parte do nome', 'silva', ['José da Silva']],
    ['parte do CPF com pontos', '982.247', ['Maria Aparecida']],
    ['parte do CPF só com números', '654321', ['José da Silva']],
    ['alguém de outra cidade', 'Fora', []],
  ])('busca por %s', async (_caso, busca, nomes) => {
    const res = await listar(await token('gestorA'), busca);

    expect(res.statusCode).toBe(200);
    expect(res.json().itens.map((u: { nome: string }) => u.nome)).toEqual(nomes);
  });

  it('busca longa demais: 400', async () => {
    const res = await listar(await token('gestorA'), 'x'.repeat(61));

    expect(res.statusCode).toBe(400);
  });

  it('cidadão não pode listar: 403', async () => {
    const res = await listar(await token('maria'));

    expect(res.statusCode).toBe(403);
    expect(res.json().erro.codigo).toBe('SEM_PERMISSAO');
  });
});

describe('PATCH /v1/usuarios/:id/senha', () => {
  it('gestor redefine a senha de um morador: 204, a nova funciona e as sessões dele caem', async () => {
    const tokenDoJose = await token('jose');

    const res = await redefinir(await token('gestorA'), ids.jose ?? '', 'senha-nova-do-jose');

    expect(res.statusCode).toBe(204);
    expect((await login('jose')).statusCode).toBe(401);
    expect((await login('jose', 'senha-nova-do-jose')).statusCode).toBe(200);
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${tokenDoJose}` },
    });
    expect(me.statusCode).toBe(401);
  });

  it('pode redefinir a de outro gestor da mesma cidade', async () => {
    const res = await redefinir(await token('gestorA'), ids.gestorB ?? '', 'senha-nova-do-bruno');

    expect(res.statusCode).toBe(204);
  });

  it('a própria senha não: 403, com a orientação de usar Alterar senha', async () => {
    const res = await redefinir(await token('gestorA'), ids.gestorA ?? '', 'qualquer-coisa-123');

    expect(res.statusCode).toBe(403);
    expect(res.json().erro.mensagem).toContain('Alterar senha');
  });

  it('usuário de outra cidade: 404, como se não existisse, e nada muda', async () => {
    const res = await redefinir(await token('gestorA'), ids.moradorFora ?? '', 'invasao-123456');

    expect(res.statusCode).toBe(404);
    expect(res.json().erro.codigo).toBe('NAO_ENCONTRADA');
    expect((await login('moradorFora')).statusCode).toBe(200);
  });

  it('usuário inexistente: 404', async () => {
    const res = await redefinir(await token('gestorA'), 'nao-existe', 'qualquer-coisa-123');

    expect(res.statusCode).toBe(404);
  });

  it('cidadão não pode redefinir: 403', async () => {
    const res = await redefinir(await token('maria'), ids.gestorA ?? '', 'golpe-123456');

    expect(res.statusCode).toBe(403);
  });

  it('senha nova curta: 422', async () => {
    const res = await redefinir(await token('gestorA'), ids.maria ?? '', '1234567');

    expect(res.statusCode).toBe(422);
    expect(res.json().erro.campos).toEqual({ novaSenha: 'mínimo de 8' });
  });
});
