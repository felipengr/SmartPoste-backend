import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

// Usa o banco local (docker) já com o seed aplicado
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('GET /v1/municipios', () => {
  it('lista os municípios conveniados no formato do contrato', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/municipios' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toContainEqual({
      id: 'piracaia',
      nome: 'Piracaia',
      uf: 'SP',
      estado: 'São Paulo',
    });
  });
});

describe('erros', () => {
  it('rota inexistente responde 404 no formato padrão', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/nao-existe' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      erro: { codigo: 'NAO_ENCONTRADA', mensagem: 'Rota não encontrada.' },
    });
  });
});

describe('GET /health', () => {
  it('responde ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
