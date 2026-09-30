import { createHash } from 'node:crypto';

import { env } from '../env.js';

export const TAMANHO_MAXIMO_FOTO = 5 * 1024 * 1024; // 5 MB (contrato)

// Recebe o JPEG e devolve a URL pública. É um tipo para os testes trocarem por um falso.
export type EnviarFoto = (jpeg: Buffer, pasta: string) => Promise<string>;

// Confere pelos primeiros bytes do arquivo, sem confiar no nome ou no tipo declarado
export function ehJpeg(arquivo: Buffer) {
  return arquivo.length > 3 && arquivo[0] === 0xff && arquivo[1] === 0xd8 && arquivo[2] === 0xff;
}

// Assinatura do Cloudinary: parâmetros em ordem alfabética + segredo, em SHA-1.
// O segredo nunca vai na requisição, só entra nesta conta.
export function assinar(parametros: Record<string, string>, segredo: string) {
  const texto = Object.keys(parametros)
    .sort()
    .map((chave) => `${chave}=${parametros[chave]}`)
    .join('&');
  return createHash('sha1')
    .update(texto + segredo)
    .digest('hex');
}

export const enviarFotoCloudinary: EnviarFoto = async (jpeg, pasta) => {
  const parametros = {
    // O Cloudinary também recusa o que não for JPEG
    allowed_formats: 'jpg',
    folder: pasta,
    timestamp: String(Math.floor(Date.now() / 1000)),
    // Reprocessa na chegada: limita a 1600 px e, com isso, apaga os metadados EXIF
    // (GPS, aparelho, horário) que o celular grava na foto, já que a URL é pública
    transformation: 'c_limit,w_1600,h_1600',
  };

  const formulario = new FormData();
  formulario.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }));
  formulario.append('api_key', env.CLOUDINARY_API_KEY);
  formulario.append('signature', assinar(parametros, env.CLOUDINARY_API_SECRET));
  for (const [chave, valor] of Object.entries(parametros)) formulario.append(chave, valor);

  const resposta = await fetch(
    `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formulario, signal: AbortSignal.timeout(30_000) },
  );

  if (!resposta.ok) {
    // Vai para o log do servidor; o usuário recebe só o 500 genérico
    throw new Error(`Cloudinary recusou o upload (${resposta.status}): ${await resposta.text()}`);
  }

  const { secure_url: url } = (await resposta.json()) as { secure_url: string };
  return url;
};
