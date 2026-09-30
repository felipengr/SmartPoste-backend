import { z } from 'zod';

// Valida as variáveis de ambiente na inicialização: se faltar algo, a API nem sobe.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3333),
});

const resultado = schema.safeParse(process.env);

if (!resultado.success) {
  console.error('Variáveis de ambiente inválidas:', z.flattenError(resultado.error).fieldErrors);
  process.exit(1);
}

export const env = resultado.data;
