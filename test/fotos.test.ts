import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '../src/env.js';
import { assinar, ehJpeg, enviarFotoCloudinary } from '../src/lib/fotos.js';

// Nada aqui chama o Cloudinary de verdade: o fetch é substituído por um falso
afterEach(() => {
  vi.unstubAllGlobals();
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('ehJpeg', () => {
  it.each([
    ['JPEG', JPEG, true],
    ['PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), false],
    ['texto com extensão .jpg', Buffer.from('não sou uma foto'), false],
    ['arquivo vazio', Buffer.alloc(0), false],
  ])('%s → %s', (_caso, arquivo, esperado) => {
    expect(ehJpeg(arquivo)).toBe(esperado);
  });
});

describe('assinar', () => {
  it('bate com o exemplo da documentação do Cloudinary', () => {
    const assinatura = assinar(
      {
        timestamp: '1315060510',
        public_id: 'sample_image',
        eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop',
      },
      'abcd',
    );

    expect(assinatura).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });
});

describe('enviarFotoCloudinary', () => {
  it('envia assinado, sem o segredo, e devolve a URL pública', async () => {
    const fetchFalso = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ secure_url: 'https://res.cloudinary.com/x/image/upload/v1/foto.jpg' }),
    );
    vi.stubGlobal('fetch', fetchFalso);

    const url = await enviarFotoCloudinary(JPEG, 'smartposte/piracaia');

    expect(url).toBe('https://res.cloudinary.com/x/image/upload/v1/foto.jpg');
    const [endereco, init] = fetchFalso.mock.calls[0] ?? ['', {}];
    expect(endereco).toBe(
      `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    );

    const campos = Object.fromEntries(
      [...(init.body as FormData).entries()].filter(([chave]) => chave !== 'file'),
    );
    expect(campos).toMatchObject({
      api_key: env.CLOUDINARY_API_KEY,
      allowed_formats: 'jpg',
      folder: 'smartposte/piracaia',
      transformation: 'c_limit,w_1600,h_1600',
    });
    // A assinatura confere com os parâmetros enviados
    const { api_key: _chave, signature, ...assinados } = campos as Record<string, string>;
    expect(signature).toBe(assinar(assinados, env.CLOUDINARY_API_SECRET));
    // O segredo nunca vai na requisição
    expect(Object.values(campos)).not.toContain(env.CLOUDINARY_API_SECRET);
  });

  it('se o Cloudinary recusar, lança erro (vira 500 genérico para o usuário)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"message":"Invalid Signature"}}', { status: 401 })),
    );

    await expect(enviarFotoCloudinary(JPEG, 'smartposte/piracaia')).rejects.toThrow(
      'Cloudinary recusou o upload (401)',
    );
  });
});
