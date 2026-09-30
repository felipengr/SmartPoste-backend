import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

// Usuário próprio do teste (a senha dele muda aqui), apagado no final
const CPF = '00000000191';
const SENHA = 'senha-inicial';
let app: FastifyInstance;
let usuarioId: string;

beforeAll(async () => {
  app = await buildApp();
  await limpar();
  const usuario = await prisma.usuario.create({
    data: {
      municipioId: 'piracaia',
      cpf: CPF,
      nome: 'Usuário do Teste /me',
      papel: 'cidadao',
      senhaHash: await argon2.hash(SENHA),
    },
  });
  usuarioId = usuario.id;

  // Duas denúncias dele, em status diferentes: as duas contam
  for (const [i, status] of (['recebida', 'resolvida'] as const).entries()) {
    await prisma.denuncia.create({
      data: {
        municipioId: 'piracaia',
        autorId: usuarioId,
        protocolo: `TESTE-ME-${i}`,
        tipos: ['fio_exposto'],
        status,
        fotoUrl: 'https://exemplo.com/foto.jpg',
        latitude: -23.05,
        longitude: -46.35,
        endereco: 'Rua de Teste',
      },
    });
  }
});

afterAll(async () => {
  await limpar();
  await app.close();
  await prisma.$disconnect();
});

async function limpar() {
  await prisma.denuncia.deleteMany({ where: { protocolo: { startsWith: 'TESTE-ME-' } } });
  await prisma.usuario.deleteMany({ where: { municipioId: 'piracaia', cpf: CPF } });
}

async function login(senha = SENHA) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { municipioId: 'piracaia', cpf: CPF, senha },
  });
  return res;
}

async function token() {
  return (await login()).json().token as string;
}

describe('GET /v1/me', () => {
  it('devolve o usuário logado e o total de denúncias dele', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${await token()}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: usuarioId,
      nome: 'Usuário do Teste /me',
      papel: 'cidadao',
      municipio: { id: 'piracaia', nome: 'Piracaia', uf: 'SP', estado: 'São Paulo' },
      estatisticas: { denuncias: 2 },
    });
    expect(res.body).not.toContain(CPF);
    expect(res.body).not.toContain('senhaHash');
  });

  it('sem token responde 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/me' });

    expect(res.statusCode).toBe(401);
    expect(res.json().erro.codigo).toBe('NAO_AUTENTICADO');
  });

  it('token de usuário removido responde 401', async () => {
    const tokenOrfao = await app.jwt.sign({
      sub: '00000000-0000-7000-8000-000000000000',
      municipioId: 'piracaia',
      papel: 'cidadao',
      versao: 0,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${tokenOrfao}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().erro.codigo).toBe('NAO_AUTENTICADO');
  });
});

describe('PATCH /v1/me/senha', () => {
  async function trocarSenha(corpo: Record<string, unknown>, tokenUsado?: string) {
    return app.inject({
      method: 'PATCH',
      url: '/v1/me/senha',
      headers: { authorization: `Bearer ${tokenUsado ?? (await token())}` },
      payload: corpo,
    });
  }

  it('senha atual errada responde 403 e não muda nada', async () => {
    const res = await trocarSenha({ senhaAtual: 'errada', novaSenha: 'nova-senha-123' });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      erro: { codigo: 'SENHA_INCORRETA', mensagem: 'A senha atual está incorreta.' },
    });
    expect((await login()).statusCode).toBe(200);
  });

  it('nova senha com menos de 8 caracteres responde 422', async () => {
    const res = await trocarSenha({ senhaAtual: SENHA, novaSenha: '1234567' });

    expect(res.statusCode).toBe(422);
    expect(res.json().erro.campos).toEqual({ novaSenha: 'mínimo de 8' });
  });

  it('sem token responde 401', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/me/senha',
      payload: { senhaAtual: SENHA, novaSenha: 'nova-senha-123' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('troca a senha: 200 com token novo, a senha antiga para de funcionar e a nova funciona', async () => {
    const tokenAtual = await token();
    const res = await trocarSenha({ senhaAtual: SENHA, novaSenha: 'nova-senha-123' }, tokenAtual);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ token: expect.any(String) });
    expect((await login(SENHA)).statusCode).toBe(401);
    expect((await login('nova-senha-123')).statusCode).toBe(200);
  });

  it('troca a senha: derruba as outras sessões e mantém a deste aparelho', async () => {
    // Senha deixada pelo teste anterior (o usuário do teste é recriado a cada execução)
    const senhaAntes = 'nova-senha-123';
    const outroAparelho = (await login(senhaAntes)).json().token as string;
    const esteAparelho = (await login(senhaAntes)).json().token as string;

    const res = await trocarSenha(
      { senhaAtual: senhaAntes, novaSenha: 'outra-senha-456' },
      esteAparelho,
    );
    const tokenNovo = res.json().token as string;

    const me = (t: string) =>
      app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${t}` } });
    expect((await me(outroAparelho)).statusCode).toBe(401);
    expect((await me(esteAparelho)).statusCode).toBe(401);
    expect((await me(tokenNovo)).statusCode).toBe(200);
  });
});
