// Dados iniciais de PRODUÇÃO: um município e o primeiro gestor dele (sem usuários de teste).
// Rode com `npm run db:seed:producao`, que lê o .env.producao (fora do git):
//   DIRECT_URL          conexão direta do Neon (sem "-pooler")
//   GESTOR_CPF          CPF do primeiro gestor
//   GESTOR_NOME         nome completo
//   GESTOR_SENHA        senha inicial (12+ caracteres)
// Município (opcional; sem estas variáveis, é Piracaia):
//   MUNICIPIO_ID        slug, ex.: "cidade-teste"
//   MUNICIPIO_NOME      ex.: "Cidade Teste"
//   MUNICIPIO_UF        ex.: "SP"
//   MUNICIPIO_ESTADO    ex.: "São Paulo"
//   MUNICIPIO_PREFIXO   prefixo do protocolo, ex.: "CT" (não pode repetir o de outra cidade)
// Pode rodar de novo: não duplica nada e não altera município nem usuário que já existem.
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
    MUNICIPIO_ID: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'só minúsculas, números e hífen (ex.: cidade-teste)')
      .default('piracaia'),
    MUNICIPIO_NOME: z.string().trim().min(2).default('Piracaia'),
    MUNICIPIO_UF: z
      .string()
      .regex(/^[A-Z]{2}$/, 'duas letras maiúsculas')
      .default('SP'),
    MUNICIPIO_ESTADO: z.string().trim().min(2).default('São Paulo'),
    MUNICIPIO_PREFIXO: z
      .string()
      .regex(/^[A-Z]{2,4}$/, '2 a 4 letras maiúsculas')
      .default('SP'),
  })
  .safeParse(process.env);

if (!dados.success) {
  console.error('Faltam dados no .env.producao:', z.flattenError(dados.error).fieldErrors);
  process.exit(1);
}

const { DIRECT_URL, GESTOR_CPF, GESTOR_NOME, GESTOR_SENHA, ...m } = dados.data;

// Só mostra o servidor, nunca o usuário e a senha da conexão
console.log('Banco:', new URL(DIRECT_URL).host);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DIRECT_URL }) });

try {
  // O protocolo é único no sistema inteiro: duas cidades com o mesmo prefixo gerariam
  // o mesmo número (ex.: SP-0001) e a segunda denúncia daria erro
  const mesmoPrefixo = await prisma.municipio.findFirst({
    where: { prefixoProtocolo: m.MUNICIPIO_PREFIXO, id: { not: m.MUNICIPIO_ID } },
    select: { nome: true },
  });
  if (mesmoPrefixo) {
    console.error(
      `Prefixo ${m.MUNICIPIO_PREFIXO} já é de ${mesmoPrefixo.nome}: escolha outro MUNICIPIO_PREFIXO.`,
    );
    process.exit(1);
  }

  const municipio = await prisma.municipio.upsert({
    where: { id: m.MUNICIPIO_ID },
    update: {},
    create: {
      id: m.MUNICIPIO_ID,
      nome: m.MUNICIPIO_NOME,
      uf: m.MUNICIPIO_UF,
      estado: m.MUNICIPIO_ESTADO,
      prefixoProtocolo: m.MUNICIPIO_PREFIXO,
    },
  });
  console.log(
    `Município: ${municipio.nome} (${municipio.id}, protocolo ${municipio.prefixoProtocolo}) ok`,
  );

  const existente = await prisma.usuario.findUnique({
    where: { municipioId_cpf: { municipioId: municipio.id, cpf: GESTOR_CPF } },
    select: { nome: true, papel: true },
  });
  if (existente) {
    console.log(`Gestor: já existia (${existente.nome}, ${existente.papel}); nada foi alterado`);
  } else {
    await prisma.usuario.create({
      data: {
        municipioId: municipio.id,
        cpf: GESTOR_CPF,
        nome: GESTOR_NOME,
        papel: 'gestor',
        senhaHash: await argon2.hash(GESTOR_SENHA),
      },
    });
    console.log(`Gestor: ${GESTOR_NOME} criado em ${municipio.nome}`);
  }
} finally {
  await prisma.$disconnect();
}
