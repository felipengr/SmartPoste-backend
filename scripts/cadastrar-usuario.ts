// Cadastra um morador (ou gestor) pela API, enquanto não existe o painel da prefeitura.
// Rode no seu terminal: npm run usuario:cadastrar
//
// Faz login como gestor (a senha é digitada escondida, nunca fica em arquivo) e chama
// POST /v1/usuarios: o usuário nasce no município do gestor, com as mesmas validações do app.
//
// Por padrão usa a API de produção; para outra, defina API_URL (ex.: http://localhost:3333/v1).
// Para automação, os dados também podem vir de variáveis: GESTOR_CPF, GESTOR_SENHA,
// NOVO_NOME, NOVO_CPF, NOVO_PAPEL, NOVA_SENHA (o que faltar é perguntado).
import { randomInt } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

const API_URL = process.env.API_URL ?? 'https://smartposte-api.onrender.com/v1';

// Senha inicial fácil de digitar e de ditar ("poste-luz-praca-4821"), mas difícil de
// adivinhar: 32³ × 10⁴ ≈ 330 milhões de combinações, com a API limitando 5 tentativas/min
const PALAVRAS = [
  'poste',
  'luz',
  'praca',
  'rua',
  'fio',
  'sol',
  'rio',
  'serra',
  'flor',
  'ponte',
  'trem',
  'lago',
  'vento',
  'pedra',
  'mata',
  'ceu',
  'lua',
  'mar',
  'campo',
  'casa',
  'banco',
  'feira',
  'jardim',
  'farol',
  'cerca',
  'trilha',
  'morro',
  'nuvem',
  'chuva',
  'folha',
  'ilha',
  'vila',
];

function gerarSenha() {
  const palavras = Array.from({ length: 3 }, () => PALAVRAS[randomInt(PALAVRAS.length)]);
  return [...palavras, String(randomInt(10_000)).padStart(4, '0')].join('-');
}

// Lê a senha sem mostrar o que é digitado (nem asteriscos)
function perguntarEscondido(texto: string): Promise<string> {
  if (!stdin.isTTY) throw new Error('Rode em um terminal interativo ou defina GESTOR_SENHA.');
  stdout.write(texto);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolver) => {
    let senha = '';
    const aoDigitar = (teclas: string) => {
      for (const tecla of teclas) {
        if (tecla === '\r' || tecla === '\n') {
          stdin.off('data', aoDigitar);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write('\n');
          resolver(senha);
          return;
        }
        if (tecla === '\u0003') process.exit(130); // Ctrl+C
        senha = tecla === '\u007f' || tecla === '\b' ? senha.slice(0, -1) : senha + tecla;
      }
    };
    stdin.on('data', aoDigitar);
  });
}

type RespostaErro = { erro?: { mensagem?: string; campos?: Record<string, string> } };

async function chamar<T>(caminho: string, corpo: unknown, token?: string): Promise<T> {
  const resposta = await fetch(`${API_URL}${caminho}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(corpo),
    // Plano grátis do Render: a API pode estar "dormindo" e levar ~50 s para acordar
    signal: AbortSignal.timeout(90_000),
  });
  const dados = (await resposta.json().catch(() => ({}))) as T & RespostaErro;
  if (!resposta.ok) {
    const campos = dados.erro?.campos ? ` (${Object.values(dados.erro.campos).join('; ')})` : '';
    throw new Error(`${dados.erro?.mensagem ?? `HTTP ${resposta.status}`}${campos}`);
  }
  return dados;
}

async function main() {
  console.log(`\nCadastro de usuário — API: ${API_URL}\n`);

  // A senha do gestor vem primeiro: o modo "escondido" não convive com o readline aberto
  const gestorSenha =
    process.env.GESTOR_SENHA ?? (await perguntarEscondido('Sua senha de gestor (escondida): '));

  const rl = createInterface({ input: stdin, output: stdout });
  const perguntar = async (texto: string, padrao?: string) => {
    // Sem terminal interativo (automação): usa o padrão ou avisa o que falta
    if (!stdin.isTTY) {
      if (padrao) return padrao;
      throw new Error(`Faltou informar "${texto.trim()}" (rode no terminal ou use as variáveis).`);
    }
    return (
      (await rl.question(padrao ? `${texto} [${padrao}]: ` : `${texto}: `)).trim() || padrao || ''
    );
  };

  try {
    const gestorCpf = process.env.GESTOR_CPF ?? (await perguntar('Seu CPF de gestor'));

    console.log('\nEntrando… (se a API estiver dormindo, pode levar até 1 minuto)');
    const { token, usuario: gestor } = await chamar<{
      token: string;
      usuario: { nome: string; municipio: { nome: string } };
    }>('/auth/login', { municipioId: 'piracaia', cpf: gestorCpf, senha: gestorSenha });
    console.log(`Olá, ${gestor.nome} (${gestor.municipio.nome}).\n`);

    console.log('Novo usuário:');
    const nome = process.env.NOVO_NOME ?? (await perguntar('  Nome completo'));
    const cpf = process.env.NOVO_CPF ?? (await perguntar('  CPF'));
    const papel =
      process.env.NOVO_PAPEL ?? (await perguntar('  Papel (cidadao ou gestor)', 'cidadao'));
    const senhaInicial =
      process.env.NOVA_SENHA ??
      (await perguntar('  Senha inicial (Enter para gerar uma fácil de digitar)', gerarSenha()));

    const criado = await chamar<{ nome: string; papel: string; municipio: { nome: string } }>(
      '/usuarios',
      { nome, cpf, senhaInicial, papel },
      token,
    );

    console.log(`\n✔ ${criado.nome} cadastrado como ${criado.papel} em ${criado.municipio.nome}.`);
    console.log(`  Senha inicial: ${senhaInicial}`);
    console.log('  Passe a senha só para essa pessoa, por mensagem privada.\n');
  } finally {
    rl.close();
  }
}

main().catch((erro: Error) => {
  console.error(
    `\n✘ ${erro.name === 'TimeoutError' ? 'A API não respondeu a tempo.' : erro.message}\n`,
  );
  process.exit(1);
});
