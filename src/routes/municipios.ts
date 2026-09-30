import type { FastifyInstance } from 'fastify';

import { prisma } from '../lib/prisma.js';

export async function municipiosRoutes(app: FastifyInstance) {
  // Público: o app chama antes do login (tela "Onde você está?")
  app.get('/municipios', async () => {
    return prisma.municipio.findMany({
      select: { id: true, nome: true, uf: true, estado: true },
      orderBy: { nome: 'asc' },
    });
  });
}
