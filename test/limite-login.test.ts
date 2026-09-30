import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { LimiteDeTentativas } from '../src/lib/limite.js';
import { prisma } from '../src/lib/prisma.js';

// Limites baixos só para o teste; em produção são 5 por conta e 20 por IP, por minuto
let app: FastifyInstance;

beforeEach(async () => {
  await app?.close();
  // App novo a cada teste: os contadores começam zerados
  app = await buildApp({ limitesLogin: { porConta: 3, porIp: 6 } });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function login(cpf: string, senha: string, ip = '10.0.0.1') {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { municipioId: 'piracaia', cpf, senha },
    remoteAddress: ip,
  });
}

describe('limite de tentativas de login', () => {
  it('por conta: passou de 3, responde 429 com Retry-After, mesmo com a senha certa', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await login('111.111.111-11', 'errada')).statusCode).toBe(401);
    }

    const res = await login('111.111.111-11', 'smartposte');

    expect(res.statusCode).toBe(429);
    expect(res.json().erro.codigo).toBe('MUITAS_TENTATIVAS');
    const segundos = Number(res.headers['retry-after']);
    expect(segundos).toBeGreaterThan(0);
    expect(segundos).toBeLessThanOrEqual(60);
    expect(res.json().erro.mensagem).toContain(`${segundos} segundos`);
  });

  it('por conta: trocar de IP não burla o limite', async () => {
    for (let i = 0; i < 3; i++) {
      await login('111.111.111-11', 'errada', `10.0.1.${i}`);
    }

    expect((await login('111.111.111-11', 'errada', '10.0.1.99')).statusCode).toBe(429);
  });

  it('CPF com e sem máscara contam como a mesma conta', async () => {
    await login('111.111.111-11', 'errada');
    await login('11111111111', 'errada');
    await login('111.111.111-11', 'errada');

    expect((await login('11111111111', 'errada')).statusCode).toBe(429);
  });

  it('por IP: passou de 6, bloqueia qualquer CPF vindo dele', async () => {
    for (let i = 0; i < 3; i++) await login('111.111.111-11', 'errada');
    for (let i = 0; i < 3; i++) await login('222.222.222-22', 'errada');

    // Uma conta que ainda não tentou nada também é barrada vindo do mesmo IP
    expect((await login('418.767.738-04', 'errada')).statusCode).toBe(429);
    // De outro IP, essa conta é atendida normalmente (401 = só a senha errada)...
    expect((await login('418.767.738-04', 'errada', '10.0.2.1')).statusCode).toBe(401);
    // ...mas a 222, que já gastou as 3 dela, segue barrada pelo limite da conta
    expect((await login('222.222.222-22', 'smartposte', '10.0.2.1')).statusCode).toBe(429);
  });
});

describe('LimiteDeTentativas', () => {
  it('libera de novo quando a janela acaba', () => {
    const limite = new LimiteDeTentativas(2, 60_000);
    const inicio = 1_000_000;

    expect(limite.registrar('x', inicio)).toBe(0);
    expect(limite.registrar('x', inicio + 1_000)).toBe(0);
    expect(limite.registrar('x', inicio + 2_000)).toBe(58);
    expect(limite.registrar('x', inicio + 60_000)).toBe(0);
  });

  it('cada chave tem a própria contagem', () => {
    const limite = new LimiteDeTentativas(1, 60_000);

    expect(limite.registrar('a', 0)).toBe(0);
    expect(limite.registrar('b', 0)).toBe(0);
    expect(limite.registrar('a', 0)).toBeGreaterThan(0);
  });
});
