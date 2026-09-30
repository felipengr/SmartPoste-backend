// Contador de tentativas por chave (ex.: CPF ou IP) numa janela de tempo fixa.
// Fica na memória do processo: basta para uma única instância da API.
export class LimiteDeTentativas {
  private readonly contagens = new Map<string, { quantidade: number; expiraEm: number }>();

  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
  ) {}

  // Conta uma tentativa. Devolve 0 se ainda está dentro do limite,
  // ou quantos segundos faltam para a janela acabar.
  registrar(chave: string, agora = Date.now()) {
    this.limparVencidas(agora);

    const atual = this.contagens.get(chave);
    if (!atual || atual.expiraEm <= agora) {
      this.contagens.set(chave, { quantidade: 1, expiraEm: agora + this.janelaMs });
      return 0;
    }

    atual.quantidade += 1;
    return atual.quantidade > this.maximo ? Math.ceil((atual.expiraEm - agora) / 1000) : 0;
  }

  // Só varre quando o mapa cresce, para não pesar em cada tentativa
  private limparVencidas(agora: number) {
    if (this.contagens.size < 10_000) return;
    for (const [chave, { expiraEm }] of this.contagens) {
      if (expiraEm <= agora) this.contagens.delete(chave);
    }
  }
}
