import { z } from 'zod';

// Valida as variáveis de ambiente na inicialização: se faltar algo, a API nem sobe.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3333),
  // IP/CIDR do proxy confiável para dizer o IP real (X-Forwarded-For), ex.: "10.0.0.0/8".
  // Vazio = ninguém (local). Confiar em qualquer um deixaria inventar o IP e driblar o
  // limite de tentativas de login (por isso o Fastify nem aceita mais "N saltos").
  TRUST_PROXY: z.string().trim().default(''),
  // Recusa o valor de exemplo do .env.example: com ele, qualquer um forjaria tokens
  JWT_SECRET: z
    .string()
    .min(32)
    .refine(
      (valor) => !valor.startsWith('troque-por'),
      'troque o valor de exemplo do .env.example',
    ),
  // Fotos das denúncias (Cloudinary → Settings → API Keys)
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
});

const resultado = schema.safeParse(process.env);

if (!resultado.success) {
  console.error('Variáveis de ambiente inválidas:', z.flattenError(resultado.error).fieldErrors);
  process.exit(1);
}

export const env = resultado.data;
