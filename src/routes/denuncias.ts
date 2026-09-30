import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Prisma } from '../generated/prisma/client.js';
import { type Coordenadas, distanciaKm } from '../lib/distancia.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

// lat e lng são opcionais, mas só fazem sentido juntos
const posicaoSchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined));

const feedSchema = z.intersection(
  posicaoSchema,
  z.object({
    limite: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().optional(),
  }),
);

// O cursor guarda onde a página anterior parou: data e id do último item.
// É só um marcador (não é segredo); se vier adulterado, a query é recusada.
const cursorSchema = z.tuple([z.iso.datetime(), z.string().min(1)]);

function criarCursor(item: { criadaEm: Date; id: string }) {
  return Buffer.from(JSON.stringify([item.criadaEm.toISOString(), item.id])).toString('base64url');
}

function lerCursor(cursor: string) {
  try {
    const [criadaEm, id] = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString()),
    );
    return { criadaEm: new Date(criadaEm), id };
  } catch {
    throw queryInvalida();
  }
}

function queryInvalida() {
  return new AppError(400, 'REQUISICAO_INVALIDA', 'Parâmetros da consulta inválidos.');
}

// Query inválida é 400 (contrato), não o 422 que o handler global dá ao ZodError
function lerQuery<T extends z.ZodType>(schema: T, request: FastifyRequest): z.output<T> {
  const resultado = schema.safeParse(request.query);
  if (!resultado.success) throw queryInvalida();
  return resultado.data;
}

const campos = {
  id: true,
  protocolo: true,
  endereco: true,
  latitude: true,
  longitude: true,
  criadaEm: true,
  tipos: true,
  status: true,
  descricao: true,
  fotoUrl: true,
  autorId: true,
} satisfies Prisma.DenunciaSelect;

type DenunciaDoBanco = Prisma.DenunciaGetPayload<{ select: typeof campos }>;

// Formato do contrato. autorId só serve para calcular "minha" e nunca sai na resposta.
function formatar(
  { autorId, ...denuncia }: DenunciaDoBanco,
  usuarioId: string,
  posicao: Coordenadas | undefined,
) {
  return {
    ...denuncia,
    distanciaKm: posicao ? distanciaKm(posicao, denuncia) : null,
    minha: autorId === usuarioId,
  };
}

function lerPosicao(q: { lat?: number | undefined; lng?: number | undefined }) {
  return q.lat !== undefined && q.lng !== undefined
    ? { latitude: q.lat, longitude: q.lng }
    : undefined;
}

export async function denunciasRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.autenticar);

  async function listar(request: FastifyRequest, filtro: Prisma.DenunciaWhereInput) {
    const query = lerQuery(feedSchema, request);
    const depoisDe = query.cursor ? lerCursor(query.cursor) : undefined;

    // Mais recentes primeiro; o id desempata denúncias criadas no mesmo instante
    const encontradas = await prisma.denuncia.findMany({
      where: {
        ...filtro,
        ...(depoisDe && {
          OR: [
            { criadaEm: { lt: depoisDe.criadaEm } },
            { criadaEm: depoisDe.criadaEm, id: { lt: depoisDe.id } },
          ],
        }),
      },
      orderBy: [{ criadaEm: 'desc' }, { id: 'desc' }],
      // Um a mais só para saber se existe próxima página
      take: query.limite + 1,
      select: campos,
    });

    const pagina = encontradas.slice(0, query.limite);
    const ultimo = pagina.at(-1);
    const posicao = lerPosicao(query);

    return {
      itens: pagina.map((d) => formatar(d, request.user.sub, posicao)),
      proximoCursor: encontradas.length > query.limite && ultimo ? criarCursor(ultimo) : null,
    };
  }

  app.get('/denuncias', (request) => listar(request, { municipioId: request.user.municipioId }));

  app.get('/denuncias/minhas', (request) =>
    listar(request, { municipioId: request.user.municipioId, autorId: request.user.sub }),
  );

  app.get('/denuncias/:id', async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const posicao = lerPosicao(lerQuery(posicaoSchema, request));

    // De outro município responde igual a inexistente: não revela que existe
    const denuncia = await prisma.denuncia.findFirst({
      where: { id, municipioId: request.user.municipioId },
      select: campos,
    });
    if (!denuncia) throw new AppError(404, 'NAO_ENCONTRADA', 'Denúncia não encontrada.');

    return formatar(denuncia, request.user.sub, posicao);
  });
}
