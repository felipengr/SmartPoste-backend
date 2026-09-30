import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

// Cidade só do teste, com prefixo próprio, para os protocolos começarem do 1
const CIDADE = 'teste-nova';
const CPF = '00000000868';
const SENHA = 'senha-de-teste';

// Envio falso: não vai ao Cloudinary, só devolve uma URL e registra a chamada
const enviarFoto = vi.fn(async (_jpeg: Buffer, _pasta: string) => 'https://fotos.teste/foto.jpg');

let app: FastifyInstance;
let token: string;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1000)]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeAll(async () => {
  app = await buildApp({ enviarFoto });
  await limpar();
  await prisma.municipio.create({
    data: {
      id: CIDADE,
      nome: 'Cidade Nova',
      uf: 'SP',
      estado: 'São Paulo',
      prefixoProtocolo: 'TN',
    },
  });
  await prisma.usuario.create({
    data: {
      municipioId: CIDADE,
      cpf: CPF,
      nome: 'Denunciante',
      senhaHash: await argon2.hash(SENHA),
    },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { municipioId: CIDADE, cpf: CPF, senha: SENHA },
  });
  token = res.json().token;
});

beforeEach(() => {
  enviarFoto.mockClear();
});

afterAll(async () => {
  await limpar();
  await app.close();
  await prisma.$disconnect();
});

async function limpar() {
  await prisma.denuncia.deleteMany({ where: { municipioId: CIDADE } });
  await prisma.usuario.deleteMany({ where: { municipioId: CIDADE } });
  await prisma.municipio.deleteMany({ where: { id: CIDADE } });
}

type Campo = [nome: string, valor: string];

// Monta o multipart/form-data como o app manda
function formulario(textos: Campo[], foto?: Buffer) {
  const limite = '----smartposte-teste';
  const partes: Buffer[] = textos.map(([nome, valor]) =>
    Buffer.from(
      `--${limite}\r\nContent-Disposition: form-data; name="${nome}"\r\n\r\n${valor}\r\n`,
    ),
  );
  if (foto) {
    partes.push(
      Buffer.from(
        `--${limite}\r\nContent-Disposition: form-data; name="foto"; filename="foto.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      foto,
      Buffer.from('\r\n'),
    );
  }
  partes.push(Buffer.from(`--${limite}--\r\n`));
  return {
    payload: Buffer.concat(partes),
    headers: { 'content-type': `multipart/form-data; boundary=${limite}` },
  };
}

const camposValidos: Campo[] = [
  ['tipos', 'fio_exposto'],
  ['tipos', 'sem_energia'],
  ['tipos', 'fio_exposto'],
  ['descricao', '  Fio rompido próximo à calçada.  '],
  ['latitude', '-23.0538'],
  ['longitude', '-46.3581'],
  ['endereco', 'Rua Dr. Cândido Rodrigues'],
];

function denunciar(textos: Campo[] = camposValidos, foto: Buffer | null = JPEG) {
  const { payload, headers } = formulario(textos, foto ?? undefined);
  return app.inject({
    method: 'POST',
    url: '/v1/denuncias',
    payload,
    headers: { ...headers, authorization: `Bearer ${token}` },
  });
}

async function ultimoProtocolo() {
  const municipio = await prisma.municipio.findUniqueOrThrow({ where: { id: CIDADE } });
  return municipio.ultimoProtocolo;
}

describe('POST /v1/denuncias', () => {
  it('cria a denúncia: 201 no formato do feed, com protocolo, status e foto', async () => {
    const res = await denunciar();

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: expect.any(String),
      protocolo: 'TN-0001',
      endereco: 'Rua Dr. Cândido Rodrigues',
      latitude: -23.0538,
      longitude: -46.3581,
      criadaEm: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      // Repetição removida
      tipos: ['fio_exposto', 'sem_energia'],
      status: 'recebida',
      descricao: 'Fio rompido próximo à calçada.',
      fotoUrl: 'https://fotos.teste/foto.jpg',
      distanciaKm: null,
      minha: true,
    });
    // A foto vai para a pasta do município do usuário
    expect(enviarFoto).toHaveBeenCalledOnce();
    expect(enviarFoto.mock.calls[0]?.[1]).toBe(`smartposte/${CIDADE}`);

    // E aparece no feed e em "minhas"
    const feed = await app.inject({
      method: 'GET',
      url: '/v1/denuncias/minhas',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(feed.json().itens[0]).toEqual(res.json());
  });

  it('protocolos seguem em sequência', async () => {
    const antes = await ultimoProtocolo();
    const res = await denunciar();

    expect(res.json().protocolo).toBe(`TN-${String(antes + 1).padStart(4, '0')}`);
  });

  it('10 denúncias ao mesmo tempo recebem 10 protocolos diferentes e seguidos', async () => {
    const antes = await ultimoProtocolo();

    const respostas = await Promise.all(Array.from({ length: 10 }, () => denunciar()));

    expect(respostas.every((r) => r.statusCode === 201)).toBe(true);
    const numeros = respostas.map((r) => Number(r.json().protocolo.slice(3))).sort((a, b) => a - b);
    expect(numeros).toEqual(Array.from({ length: 10 }, (_, i) => antes + 1 + i));
  });

  it('descrição é opcional', async () => {
    const res = await denunciar(camposValidos.filter(([nome]) => nome !== 'descricao'));

    expect(res.statusCode).toBe(201);
    expect(res.json().descricao).toBe('');
  });

  it.each<[string, Campo[], Buffer | null, Record<string, string>]>([
    ['sem foto', camposValidos, null, { foto: 'obrigatório' }],
    ['foto PNG', camposValidos, PNG, { foto: 'a foto deve ser JPEG' }],
    [
      'sem tipos',
      camposValidos.filter(([nome]) => nome !== 'tipos'),
      JPEG,
      { tipos: 'selecione ao menos um tipo' },
    ],
    [
      'tipo desconhecido',
      [...camposValidos, ['tipos', 'poste_torto']],
      JPEG,
      { tipos: 'tipo desconhecido' },
    ],
    [
      'sem localização nem endereço',
      [['tipos', 'fio_exposto']],
      JPEG,
      { latitude: 'obrigatório', longitude: 'obrigatório', endereco: 'obrigatório' },
    ],
    [
      'latitude vazia (não pode virar 0)',
      camposValidos.map(([n, v]): Campo => (n === 'latitude' ? [n, ''] : [n, v])),
      JPEG,
      { latitude: 'obrigatório' },
    ],
    [
      'latitude fora do mapa',
      camposValidos.map(([n, v]): Campo => (n === 'latitude' ? [n, '91'] : [n, v])),
      JPEG,
      { latitude: 'máximo de 90' },
    ],
    [
      'descrição com mais de 300 caracteres',
      [...camposValidos.filter(([nome]) => nome !== 'descricao'), ['descricao', 'a'.repeat(301)]],
      JPEG,
      { descricao: 'máximo de 300' },
    ],
  ])('%s: 422 com os campos, sem enviar a foto', async (_caso, textos, foto, campos) => {
    const antes = await ultimoProtocolo();

    const res = await denunciar(textos, foto);

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ erro: { codigo: 'DADOS_INVALIDOS', campos } });
    expect(enviarFoto).not.toHaveBeenCalled();
    expect(await ultimoProtocolo()).toBe(antes);
  });

  it('foto com mais de 5 MB: 422, sem enviar', async () => {
    const grande = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);

    const res = await denunciar(camposValidos, grande);

    expect(res.statusCode).toBe(422);
    expect(res.json().erro.campos).toEqual({ foto: 'máximo de 5 MB' });
    expect(enviarFoto).not.toHaveBeenCalled();
  });

  it('ignora município enviado no formulário: usa o do usuário', async () => {
    const res = await denunciar([...camposValidos, ['municipioId', 'piracaia']]);

    expect(res.statusCode).toBe(201);
    expect(res.json().protocolo).toMatch(/^TN-/);
  });

  it('se o upload falhar: 500 genérico, sem criar denúncia nem gastar protocolo', async () => {
    enviarFoto.mockRejectedValueOnce(
      new Error('Cloudinary recusou o upload (500): detalhe interno'),
    );
    const antes = await ultimoProtocolo();
    const totalAntes = await prisma.denuncia.count({ where: { municipioId: CIDADE } });

    const res = await denunciar();

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno. Tente novamente mais tarde.' },
    });
    expect(res.body).not.toContain('Cloudinary');
    expect(await ultimoProtocolo()).toBe(antes);
    expect(await prisma.denuncia.count({ where: { municipioId: CIDADE } })).toBe(totalAntes);
  });

  it('corpo que não é multipart: 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/denuncias',
      payload: { tipos: ['fio_exposto'] },
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().erro.codigo).toBe('REQUISICAO_INVALIDA');
  });

  it('sem token: 401', async () => {
    const { payload, headers } = formulario(camposValidos, JPEG);

    const res = await app.inject({ method: 'POST', url: '/v1/denuncias', payload, headers });

    expect(res.statusCode).toBe(401);
    expect(enviarFoto).not.toHaveBeenCalled();
  });
});
