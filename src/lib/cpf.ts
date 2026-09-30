import { z } from 'zod';

// Aceita com ou sem máscara; guardamos e comparamos só os dígitos
export const cpfDigitos = z
  .string()
  .transform((valor) => valor.replace(/\D/g, ''))
  .refine((digitos) => digitos.length === 11, 'deve ter 11 dígitos');

// Para cadastro: além dos 11 dígitos, confere os dígitos verificadores
export const cpfValido = cpfDigitos.refine(digitosVerificadoresConferem, 'CPF inválido');

function digitosVerificadoresConferem(cpf: string) {
  // 000.000.000-00, 111.111.111-11… passam na conta, mas não são CPFs reais
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const numeros = [...cpf].map(Number);
  for (const posicao of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < posicao; i++) soma += (numeros[i] ?? 0) * (posicao + 1 - i);
    const digito = ((soma * 10) % 11) % 10;
    if (digito !== numeros[posicao]) return false;
  }
  return true;
}
