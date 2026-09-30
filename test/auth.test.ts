import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

// Usa o banco local (docker) já com o seed aplicado
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  // Rota só de teste para exercitar o app.autenticar antes de existir uma rota protegida real
  app.get('/teste/protegida', { onRequest: [app.autenticar] }, async (request) => request.user);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

afterEach(() => {
  vi.useRealTimers();
});

function login(corpo: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/v1/auth/login', payload: corpo });
}

const credenciaisInvalidas = {
  erro: { codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'CPF ou senha incorretos.' },
};

describe('POST /v1/auth/login', () => {
  it('devolve token e usuário no formato do contrato', async () => {
    const res = await login({
      municipioId: 'piracaia',
      cpf: '111.111.111-11',
      senha: 'smartposte',
    });

    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo).toEqual({
      token: expect.any(String),
      usuario: {
        id: expect.any(String),
        nome: 'Cidadão de Teste',
        papel: 'cidadao',
        municipio: { id: 'piracaia', nome: 'Piracaia', uf: 'SP', estado: 'São Paulo' },
      },
    });
    // Nunca devolver dados sensíveis
    expect(res.body).not.toContain('senhaHash');
    expect(res.body).not.toContain('11111111111');
  });

  it('aceita CPF sem máscara', async () => {
    const res = await login({ municipioId: 'piracaia', cpf: '22222222222', senha: 'smartposte' });

    expect(res.statusCode).toBe(200);
    expect(res.json().usuario.papel).toBe('gestor');
  });

  it('token expira em 30 dias e carrega id, município e papel', async () => {
    const res = await login({
      municipioId: 'piracaia',
      cpf: '111.111.111-11',
      senha: 'smartposte',
    });
    const { token, usuario } = res.json();

    const payload = app.jwt.decode<{
      sub: string;
      municipioId: string;
      papel: string;
      iat: number;
      exp: number;
    }>(token);
    expect(payload).toMatchObject({ sub: usuario.id, municipioId: 'piracaia', papel: 'cidadao' });
    expect(payload?.exp && payload.exp - payload.iat).toBe(30 * 24 * 60 * 60);
  });

  it.each([
    ['senha errada', { municipioId: 'piracaia', cpf: '111.111.111-11', senha: 'errada123' }],
    ['CPF inexistente', { municipioId: 'piracaia', cpf: '999.999.999-99', senha: 'smartposte' }],
    [
      'município de outro usuário',
      { municipioId: 'outra-cidade', cpf: '111.111.111-11', senha: 'smartposte' },
    ],
  ])('%s responde 401 igual, sem revelar o motivo', async (_caso, corpo) => {
    const res = await login(corpo);

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(credenciaisInvalidas);
  });

  it('corpo inválido responde 422 com os campos', async () => {
    const res = await login({ municipioId: 'piracaia', cpf: '123' });

    expect(res.statusCode).toBe(422);
    expect(res.json().erro).toMatchObject({
      codigo: 'DADOS_INVALIDOS',
      campos: { cpf: 'deve ter 11 dígitos', senha: 'obrigatório' },
    });
  });
});

describe('app.autenticar', () => {
  const naoAutenticado = {
    erro: { codigo: 'NAO_AUTENTICADO', mensagem: 'Sua sessão expirou. Faça login novamente.' },
  };

  async function tokenValido() {
    const res = await login({
      municipioId: 'piracaia',
      cpf: '111.111.111-11',
      senha: 'smartposte',
    });
    return res.json().token as string;
  }

  function chamarProtegida(token?: string) {
    return app.inject({
      method: 'GET',
      url: '/teste/protegida',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  it('libera com token válido e expõe o usuário em request.user', async () => {
    const res = await chamarProtegida(await tokenValido());

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ municipioId: 'piracaia', papel: 'cidadao' });
  });

  it('sem token responde 401', async () => {
    const res = await chamarProtegida();

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(naoAutenticado);
  });

  it('token adulterado responde 401', async () => {
    const token = await tokenValido();
    // Troca o papel no payload sem reassinar: a assinatura deixa de bater
    const [cabecalho, payload = '', assinatura] = token.split('.');
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const adulterado = Buffer.from(JSON.stringify({ ...dados, papel: 'gestor' })).toString(
      'base64url',
    );

    const res = await chamarProtegida(`${cabecalho}.${adulterado}.${assinatura}`);

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(naoAutenticado);
  });

  it('token vencido (mais de 30 dias) responde 401', async () => {
    const token = await tokenValido();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);

    const res = await chamarProtegida(token);

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(naoAutenticado);
  });
});
