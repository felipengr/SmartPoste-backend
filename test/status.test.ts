import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { StatusDenuncia } from '../src/generated/prisma/enums.js';
import { prisma } from '../src/lib/prisma.js';

// Duas cidades só do teste: na primeira, um gestor e um cidadão (autor); na outra, um gestor de fora
const CIDADE = 'teste-status';
const OUTRA_CIDADE = 'teste-status-2';
const SENHA = 'senha-de-teste';

let app: FastifyInstance;
let tokenGestor: string;
let tokenCidadao: string;
let tokenGestorDeFora: string;
let gestorId: string;
let cidadaoId: string;
let contador = 0;

beforeAll(async () => {
  app = await buildApp();
  await limpar();

  for (const id of [CIDADE, OUTRA_CIDADE]) {
    await prisma.municipio.create({
      data: { id, nome: id, uf: 'SP', estado: 'São Paulo', prefixoProtocolo: 'TS' },
    });
  }
  const senhaHash = await argon2.hash(SENHA);
  const criar = (municipioId: string, cpf: string, papel: 'gestor' | 'cidadao') =>
    prisma.usuario.create({
      data: { municipioId, cpf, nome: `${papel} ${cpf}`, papel, senhaHash },
    });

  gestorId = (await criar(CIDADE, '00000000949', 'gestor')).id;
  cidadaoId = (await criar(CIDADE, '00000001082', 'cidadao')).id;
  await criar(OUTRA_CIDADE, '00000001163', 'gestor');

  tokenGestor = await login(CIDADE, '00000000949');
  tokenCidadao = await login(CIDADE, '00000001082');
  tokenGestorDeFora = await login(OUTRA_CIDADE, '00000001163');
});

afterAll(async () => {
  await limpar();
  await app.close();
  await prisma.$disconnect();
});

async function limpar() {
  const cidades = { in: [CIDADE, OUTRA_CIDADE] };
  // Apagar a denúncia apaga o histórico junto (cascade)
  await prisma.denuncia.deleteMany({ where: { municipioId: cidades } });
  await prisma.usuario.deleteMany({ where: { municipioId: cidades } });
  await prisma.municipio.deleteMany({ where: { id: cidades } });
}

async function login(municipioId: string, cpf: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { municipioId, cpf, senha: SENHA },
  });
  return res.json().token as string;
}

// Cada teste usa uma denúncia nova, do cidadão, já no status desejado
async function novaDenuncia(status: StatusDenuncia = 'recebida') {
  contador += 1;
  const denuncia = await prisma.denuncia.create({
    data: {
      municipioId: CIDADE,
      autorId: cidadaoId,
      protocolo: `TS-${String(contador).padStart(4, '0')}`,
      tipos: ['sem_energia'],
      status,
      fotoUrl: 'https://exemplo.com/foto.jpg',
      latitude: -23.05,
      longitude: -46.35,
      endereco: 'Rua do Teste',
    },
  });
  return denuncia.id;
}

function mudarStatus(id: string, status: string, token = tokenGestor) {
  return app.inject({
    method: 'PATCH',
    url: `/v1/denuncias/${id}/status`,
    headers: { authorization: `Bearer ${token}` },
    payload: { status },
  });
}

async function statusNoBanco(id: string) {
  return (await prisma.denuncia.findUniqueOrThrow({ where: { id } })).status;
}

function historico(denunciaId: string) {
  return prisma.historicoStatus.findMany({
    where: { denunciaId },
    orderBy: { em: 'asc' },
    select: { de: true, para: true, gestorId: true },
  });
}

describe('PATCH /v1/denuncias/:id/status', () => {
  it('recebida → em_analise: 200 com o item atualizado e registra no histórico', async () => {
    const id = await novaDenuncia();

    const res = await mudarStatus(id, 'em_analise');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id,
      status: 'em_analise',
      distanciaKm: null,
      // Quem mudou foi o gestor, não o autor
      minha: false,
    });
    // O autor segue sem aparecer
    expect(res.body).not.toContain(cidadaoId);
    expect(await historico(id)).toEqual([{ de: 'recebida', para: 'em_analise', gestorId }]);
  });

  it('segue até resolvida, com uma entrada no histórico por mudança', async () => {
    const id = await novaDenuncia();

    await mudarStatus(id, 'em_analise');
    const res = await mudarStatus(id, 'resolvida');

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('resolvida');
    expect(await historico(id)).toEqual([
      { de: 'recebida', para: 'em_analise', gestorId },
      { de: 'em_analise', para: 'resolvida', gestorId },
    ]);
  });

  it.each<[string, StatusDenuncia, string, string]>([
    ['pular etapa', 'recebida', 'resolvida', 'de recebida só pode ir para em_analise'],
    ['repetir o mesmo status', 'recebida', 'recebida', 'de recebida só pode ir para em_analise'],
    ['voltar', 'em_analise', 'recebida', 'de em_analise só pode ir para resolvida'],
    ['mexer numa resolvida', 'resolvida', 'em_analise', 'a denúncia já está resolvida'],
  ])('%s: 422 e nada muda', async (_caso, de, para, mensagem) => {
    const id = await novaDenuncia(de);

    const res = await mudarStatus(id, para);

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      erro: { codigo: 'DADOS_INVALIDOS', campos: { status: mensagem } },
    });
    expect(await statusNoBanco(id)).toBe(de);
    expect(await historico(id)).toEqual([]);
  });

  it('status desconhecido: 422', async () => {
    const id = await novaDenuncia();

    const res = await mudarStatus(id, 'arquivada');

    expect(res.statusCode).toBe(422);
    expect(Object.keys(res.json().erro.campos)).toEqual(['status']);
  });

  it('5 gestores ao mesmo tempo: só uma mudança vale e o histórico tem uma entrada', async () => {
    const id = await novaDenuncia();

    const respostas = await Promise.all(
      Array.from({ length: 5 }, () => mudarStatus(id, 'em_analise')),
    );

    expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 422, 422, 422, 422]);
    expect(await historico(id)).toHaveLength(1);
  });

  it('cidadão não pode mudar: 403 e nada muda', async () => {
    const id = await novaDenuncia();

    const res = await mudarStatus(id, 'em_analise', tokenCidadao);

    expect(res.statusCode).toBe(403);
    expect(res.json().erro.codigo).toBe('SEM_PERMISSAO');
    expect(await statusNoBanco(id)).toBe('recebida');
  });

  it('gestor de outro município: 404, sem revelar que a denúncia existe', async () => {
    const id = await novaDenuncia();

    const res = await mudarStatus(id, 'em_analise', tokenGestorDeFora);

    expect(res.statusCode).toBe(404);
    expect(res.json().erro.codigo).toBe('NAO_ENCONTRADA');
    expect(await statusNoBanco(id)).toBe('recebida');
  });

  it('denúncia inexistente: 404', async () => {
    const res = await mudarStatus('nao-existe', 'em_analise');

    expect(res.statusCode).toBe(404);
  });

  it('sem token: 401', async () => {
    const id = await novaDenuncia();

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/denuncias/${id}/status`,
      payload: { status: 'em_analise' },
    });

    expect(res.statusCode).toBe(401);
  });
});
