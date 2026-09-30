import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError, z } from 'zod';

// Códigos de erro do contrato (docs/API.md → "Erros")
export type CodigoErro =
  | 'REQUISICAO_INVALIDA'
  | 'NAO_AUTENTICADO'
  | 'CREDENCIAIS_INVALIDAS'
  | 'SEM_PERMISSAO'
  | 'NAO_ENCONTRADA'
  | 'CPF_JA_CADASTRADO'
  | 'SENHA_INCORRETA'
  | 'DADOS_INVALIDOS'
  | 'ERRO_INTERNO';

// Lance nas rotas para responder um erro esperado:
// throw new AppError(404, 'NAO_ENCONTRADA', 'Denúncia não encontrada.')
// `campos` só em 422, como no contrato: { foto: 'obrigatório' }
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly codigo: CodigoErro,
    mensagem: string,
    readonly campos?: Record<string, string>,
  ) {
    super(mensagem);
  }
}

// { campo: primeira mensagem }, pelo nome do campo principal: erro em tipos[1] vira "tipos"
export function camposDoZod(error: ZodError) {
  const campos: Record<string, string> = {};
  for (const issue of error.issues) {
    campos[String(issue.path[0] ?? '_')] ??= issue.message;
  }
  return campos;
}

type CorpoErro = {
  erro: { codigo: CodigoErro; mensagem: string; campos?: Record<string, string> };
};

// Transforma qualquer erro no formato { erro: { codigo, mensagem, campos? } }
export function registrarTratamentoDeErros(app: FastifyInstance) {
  app.setErrorHandler<FastifyError | Error>((error, request, reply) => {
    if (error instanceof AppError) {
      const { codigo, message: mensagem, campos } = error;
      return reply
        .status(error.statusCode)
        .send({ erro: { codigo, mensagem, ...(campos && { campos }) } } satisfies CorpoErro);
    }

    if (error instanceof ZodError) {
      return reply.status(422).send({
        erro: {
          codigo: 'DADOS_INVALIDOS',
          mensagem: 'Alguns dados estão inválidos.',
          campos: camposDoZod(error),
        },
      } satisfies CorpoErro);
    }

    // Erros do próprio Fastify com status 4xx (JSON malformado, corpo grande demais,
    // formulário que não é multipart…): o contrato responde tudo como 400
    const status = 'statusCode' in error ? error.statusCode : undefined;
    if (status && status >= 400 && status < 500) {
      return reply.status(400).send({
        erro: { codigo: 'REQUISICAO_INVALIDA', mensagem: 'Requisição inválida.' },
      } satisfies CorpoErro);
    }

    // Inesperado: registra o detalhe no log, mas não expõe na resposta
    request.log.error(error);
    return reply.status(500).send({
      erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno. Tente novamente mais tarde.' },
    } satisfies CorpoErro);
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      erro: { codigo: 'NAO_ENCONTRADA', mensagem: 'Rota não encontrada.' },
    } satisfies CorpoErro);
  });
}

// Mensagens do zod em português para os casos mais comuns
z.config({
  customError: (issue) => {
    if (issue.code === 'invalid_type' && issue.input === undefined) return 'obrigatório';
    if (issue.code === 'too_small') return `mínimo de ${issue.minimum}`;
    if (issue.code === 'too_big') return `máximo de ${issue.maximum}`;
    return undefined;
  },
});
