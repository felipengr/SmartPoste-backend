import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { distanciaKm } from '../src/lib/distancia.js';
import { prisma } from '../src/lib/prisma.js';

// Duas cidades só do teste, para o feed não depender do que existe em Piracaia
const CIDADE = 'teste-feed';
const OUTRA_CIDADE = 'teste-feed-2';
const SENHA = 'senha-de-teste';
const TOTAL = 25; // na CIDADE: 10 minhas + 15 de outra pessoa
const LOCAL = { latitude: -23.0538, longitude: -46.3581 };

let app: FastifyInstance;
let token: string;
let idOutraCidade: string;

beforeAll(async () => {
  app = await buildApp();
  await limpar();

  for (const [id, nome] of [
    [CIDADE, 'Cidade de Teste'],
    [OUTRA_CIDADE, 'Outra Cidade de Teste'],
  ] as const) {
    await prisma.municipio.create({
      data: { id, nome, uf: 'SP', estado: 'São Paulo', prefixoProtocolo: 'TF' },
    });
  }

  const senhaHash = await argon2.hash(SENHA);
  const eu = await prisma.usuario.create({
    data: { municipioId: CIDADE, cpf: '00000000515', nome: 'Eu', papel: 'cidadao', senhaHash },
  });
  const vizinho = await prisma.usuario.create({
    data: { municipioId: CIDADE, cpf: '00000000604', nome: 'Vizinho Secreto', senhaHash },
  });
  const deFora = await prisma.usuario.create({
    data: { municipioId: OUTRA_CIDADE, cpf: '00000000787', nome: 'De Fora', senhaHash },
  });

  // Uma denúncia por minuto; as 3 primeiras no mesmo instante, para testar o desempate por id
  const base = Date.parse('2026-09-01T12:00:00.000Z');
  await prisma.denuncia.createMany({
    data: Array.from({ length: TOTAL }, (_, i) => ({
      municipioId: CIDADE,
      autorId: i % 5 < 2 ? eu.id : vizinho.id,
      protocolo: `TF-${String(i).padStart(4, '0')}`,
      tipos: ['fio_exposto' as const],
      fotoUrl: `https://exemplo.com/${i}.jpg`,
      // Cada uma 0,01° mais ao norte (~1,1 km)
      latitude: LOCAL.latitude + i * 0.01,
      longitude: LOCAL.longitude,
      endereco: `Rua ${i}`,
      criadaEm: new Date(base + Math.max(i, 2) * 60_000),
    })),
  });

  const fora = await prisma.denuncia.create({
    data: {
      municipioId: OUTRA_CIDADE,
      autorId: deFora.id,
      protocolo: 'TF-FORA',
      tipos: ['sem_energia'],
      fotoUrl: 'https://exemplo.com/fora.jpg',
      latitude: 0,
      longitude: 0,
      endereco: 'Longe',
    },
  });
  idOutraCidade = fora.id;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { municipioId: CIDADE, cpf: '00000000515', senha: SENHA },
  });
  token = res.json().token;
});

afterAll(async () => {
  await limpar();
  await app.close();
  await prisma.$disconnect();
});

async function limpar() {
  const cidades = { in: [CIDADE, OUTRA_CIDADE] };
  await prisma.denuncia.deleteMany({ where: { municipioId: cidades } });
  await prisma.usuario.deleteMany({ where: { municipioId: cidades } });
  await prisma.municipio.deleteMany({ where: { id: cidades } });
}

function get(url: string, comToken = true) {
  return app.inject({
    method: 'GET',
    url,
    headers: comToken ? { authorization: `Bearer ${token}` } : {},
  });
}

type Pagina = { itens: Array<Record<string, unknown>>; proximoCursor: string | null };

// Percorre todas as páginas seguindo o proximoCursor
async function todasAsPaginas(url: string) {
  const paginas: Pagina[] = [];
  let cursor: string | null = null;
  do {
    const separador = url.includes('?') ? '&' : '?';
    const res = await get(cursor ? `${url}${separador}cursor=${cursor}` : url);
    expect(res.statusCode).toBe(200);
    const pagina: Pagina = res.json();
    paginas.push(pagina);
    cursor = pagina.proximoCursor;
  } while (cursor);
  return paginas;
}

describe('GET /v1/denuncias', () => {
  it('item no formato do contrato, sem dados de quem denunciou', async () => {
    const res = await get('/v1/denuncias?limite=1');

    expect(res.statusCode).toBe(200);
    const [item] = res.json().itens;
    expect(Object.keys(item).sort()).toEqual(
      [
        'id',
        'protocolo',
        'endereco',
        'latitude',
        'longitude',
        'criadaEm',
        'tipos',
        'status',
        'descricao',
        'fotoUrl',
        'distanciaKm',
        'minha',
      ].sort(),
    );
    expect(item).toMatchObject({
      protocolo: 'TF-0024',
      criadaEm: '2026-09-01T12:24:00.000Z',
      tipos: ['fio_exposto'],
      status: 'recebida',
      distanciaKm: null,
    });
    expect(res.body).not.toContain('autorId');
    expect(res.body).not.toContain('Vizinho Secreto');
    expect(res.body).not.toContain('00000000604');
  });

  it('pagina com 20 por padrão e percorre tudo sem repetir nem pular', async () => {
    const paginas = await todasAsPaginas('/v1/denuncias');

    expect(paginas.map((p) => p.itens.length)).toEqual([20, 5]);
    expect(paginas.at(-1)?.proximoCursor).toBeNull();

    const protocolos = paginas.flatMap((p) => p.itens.map((i) => i.protocolo));
    // Mais recentes primeiro; empate no mesmo instante resolvido sem perder ninguém
    expect(new Set(protocolos).size).toBe(TOTAL);
    const datas = paginas.flatMap((p) => p.itens.map((i) => Date.parse(String(i.criadaEm))));
    expect(datas).toEqual([...datas].sort((a, b) => b - a));
  });

  it('respeita o limite, inclusive quando o corte cai no meio de um empate', async () => {
    const paginas = await todasAsPaginas('/v1/denuncias?limite=4');

    expect(paginas.map((p) => p.itens.length)).toEqual([4, 4, 4, 4, 4, 4, 1]);
    const protocolos = paginas.flatMap((p) => p.itens.map((i) => i.protocolo));
    expect(new Set(protocolos).size).toBe(TOTAL);
  });

  it('não mostra denúncias de outro município', async () => {
    const paginas = await todasAsPaginas('/v1/denuncias?limite=50');

    expect(paginas[0]?.itens).toHaveLength(TOTAL);
    expect(JSON.stringify(paginas)).not.toContain('TF-FORA');
  });

  it('marca minha: true só nas do usuário logado', async () => {
    const res = await get('/v1/denuncias?limite=50');
    const itens: Array<{ minha: boolean }> = res.json().itens;

    expect(itens.filter((i) => i.minha)).toHaveLength(10);
  });

  it('com lat e lng, calcula a distância de cada item em km', async () => {
    const res = await get(`/v1/denuncias?limite=50&lat=${LOCAL.latitude}&lng=${LOCAL.longitude}`);
    const itens: Array<{ protocolo: string; distanciaKm: number }> = res.json().itens;

    expect(itens.find((i) => i.protocolo === 'TF-0000')?.distanciaKm).toBe(0);
    // 0,24° de latitude ≈ 26,7 km
    expect(itens.find((i) => i.protocolo === 'TF-0024')?.distanciaKm).toBe(26.7);
  });

  it.each([
    ['limite acima de 50', 'limite=51'],
    ['limite zero', 'limite=0'],
    ['limite não numérico', 'limite=abc'],
    ['lat sem lng', 'lat=-23.05'],
    ['latitude fora do mapa', 'lat=91&lng=0'],
    ['cursor adulterado', 'cursor=nao-e-um-cursor'],
    ['cursor com formato errado', `cursor=${Buffer.from('{"a":1}').toString('base64url')}`],
  ])('%s responde 400', async (_caso, query) => {
    const res = await get(`/v1/denuncias?${query}`);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      erro: { codigo: 'REQUISICAO_INVALIDA', mensagem: 'Parâmetros da consulta inválidos.' },
    });
  });

  it('sem token responde 401', async () => {
    const res = await get('/v1/denuncias', false);

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/denuncias/minhas', () => {
  it('só as do usuário logado, com a mesma paginação', async () => {
    const paginas = await todasAsPaginas('/v1/denuncias/minhas?limite=3');

    const itens = paginas.flatMap((p) => p.itens);
    expect(itens).toHaveLength(10);
    expect(itens.every((i) => i.minha === true)).toBe(true);
    expect(paginas.at(-1)?.proximoCursor).toBeNull();
  });
});

describe('GET /v1/denuncias/:id', () => {
  it('devolve um item no mesmo formato do feed', async () => {
    const feed = await get('/v1/denuncias?limite=1');
    const [primeiro] = feed.json().itens;

    const res = await get(
      `/v1/denuncias/${primeiro.id}?lat=${LOCAL.latitude}&lng=${LOCAL.longitude}`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...primeiro, distanciaKm: 26.7 });
  });

  it('de outro município responde 404, como se não existisse', async () => {
    const res = await get(`/v1/denuncias/${idOutraCidade}`);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      erro: { codigo: 'NAO_ENCONTRADA', mensagem: 'Denúncia não encontrada.' },
    });
  });

  it('inexistente responde 404', async () => {
    const res = await get('/v1/denuncias/nao-existe');

    expect(res.statusCode).toBe(404);
  });
});

describe('distanciaKm', () => {
  it('São Paulo → Rio de Janeiro ≈ 357 km', () => {
    const sp = { latitude: -23.5505, longitude: -46.6333 };
    const rio = { latitude: -22.9068, longitude: -43.1729 };

    expect(distanciaKm(sp, rio)).toBeCloseTo(357, -1);
  });
});
