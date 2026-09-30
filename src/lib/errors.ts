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
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly codigo: CodigoErro,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

type CorpoErro = {
  erro: { codigo: CodigoErro; mensagem: string; campos?: Record<string, string> };
};

// Transforma qualquer erro no formato { erro: { codigo, mensagem, campos? } }
export function registrarTratamentoDeErros(app: FastifyInstance) {
  app.setErrorHandler<FastifyError | Error>((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send({ erro: { codigo: error.codigo, mensagem: error.message } } satisfies CorpoErro);
    }

    if (error instanceof ZodError) {
      const campos: Record<string, string> = {};
      for (const issue of error.issues) {
        const campo = issue.path.join('.') || '_';
        campos[campo] ??= issue.message;
      }
      return reply.status(422).send({
        erro: {
          codigo: 'DADOS_INVALIDOS',
          mensagem: 'Alguns dados estão inválidos.',
          campos,
        },
      } satisfies CorpoErro);
    }

    // Erros do próprio Fastify com status 4xx (JSON malformado, corpo grande demais…)
    const status = 'statusCode' in error ? error.statusCode : undefined;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({
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
