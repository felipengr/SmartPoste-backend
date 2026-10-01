// Dados iniciais de PRODUÇÃO: só o município e o primeiro gestor (sem usuários de teste).
// Rode com `npm run db:seed:producao`, que lê o .env.producao (fora do git):
//   DIRECT_URL     conexão direta do Neon (sem "-pooler")
//   GESTOR_CPF     CPF do primeiro gestor
//   GESTOR_NOME    nome completo
//   GESTOR_SENHA   senha inicial (12+ caracteres)
// Pode rodar de novo: não duplica nada e não altera um usuário que já existe.
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { z } from 'zod';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { cpfValido } from '../src/lib/cpf.js';

const dados = z
  .object({
    DIRECT_URL: z.url(),
    GESTOR_CPF: cpfValido,
    GESTOR_NOME: z.string().trim().min(3),
    GESTOR_SENHA: z.string().min(12, 'use 12 caracteres ou mais'),
  })
  .safeParse(process.env);

if (!dados.success) {
  console.error('Faltam dados no .env.producao:', z.flattenError(dados.error).fieldErrors);
  process.exit(1);
}

const { DIRECT_URL, GESTOR_CPF, GESTOR_NOME, GESTOR_SENHA } = dados.data;

// Só mostra o servidor, nunca o usuário e a senha da conexão
console.log('Banco:', new URL(DIRECT_URL).host);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DIRECT_URL }) });

try {
  await prisma.municipio.upsert({
    where: { id: 'piracaia' },
    update: {},
    create: {
      id: 'piracaia',
      nome: 'Piracaia',
      uf: 'SP',
      estado: 'São Paulo',
      prefixoProtocolo: 'SP',
    },
  });
  console.log('Município: Piracaia ok');

  const existente = await prisma.usuario.findUnique({
    where: { municipioId_cpf: { municipioId: 'piracaia', cpf: GESTOR_CPF } },
    select: { nome: true, papel: true },
  });
  if (existente) {
    console.log(`Gestor: já existia (${existente.nome}, ${existente.papel}); nada foi alterado`);
  } else {
    await prisma.usuario.create({
      data: {
        municipioId: 'piracaia',
        cpf: GESTOR_CPF,
        nome: GESTOR_NOME,
        papel: 'gestor',
        senhaHash: await argon2.hash(GESTOR_SENHA),
      },
    });
    console.log(`Gestor: ${GESTOR_NOME} criado`);
  }
} finally {
  await prisma.$disconnect();
}
