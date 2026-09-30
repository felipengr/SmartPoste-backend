// Dados iniciais para desenvolvimento. Rode com `npm run db:seed` (pode rodar várias vezes).
import 'dotenv/config';
import argon2 from 'argon2';

import { prisma } from '../src/lib/prisma.js';

// Senha dos usuários de teste. Só para desenvolvimento local!
const SENHA_DEV = 'smartposte';

async function main() {
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

  const senhaHash = await argon2.hash(SENHA_DEV);

  const usuarios = [
    { cpf: '11111111111', nome: 'Cidadão de Teste', papel: 'cidadao' },
    { cpf: '22222222222', nome: 'Gestor de Teste', papel: 'gestor' },
  ] as const;

  for (const u of usuarios) {
    await prisma.usuario.upsert({
      where: { municipioId_cpf: { municipioId: 'piracaia', cpf: u.cpf } },
      update: {},
      create: { ...u, municipioId: 'piracaia', senhaHash },
    });
  }

  console.log('Seed concluído: município Piracaia + usuários de teste (senha: %s)', SENHA_DEV);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
