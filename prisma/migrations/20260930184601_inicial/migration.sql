-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('cidadao', 'gestor');

-- CreateEnum
CREATE TYPE "TipoProblema" AS ENUM ('fio_exposto', 'sem_energia', 'sem_internet', 'sem_telefone', 'risco_populacao');

-- CreateEnum
CREATE TYPE "StatusDenuncia" AS ENUM ('recebida', 'em_analise', 'resolvida');

-- CreateTable
CREATE TABLE "municipios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "uf" CHAR(2) NOT NULL,
    "estado" TEXT NOT NULL,
    "prefixo_protocolo" TEXT NOT NULL,
    "ultimo_protocolo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "municipios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "municipio_id" TEXT NOT NULL,
    "cpf" VARCHAR(11) NOT NULL,
    "nome" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "papel" "Papel" NOT NULL DEFAULT 'cidadao',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "denuncias" (
    "id" TEXT NOT NULL,
    "municipio_id" TEXT NOT NULL,
    "autor_id" TEXT NOT NULL,
    "protocolo" TEXT NOT NULL,
    "tipos" "TipoProblema"[],
    "status" "StatusDenuncia" NOT NULL DEFAULT 'recebida',
    "descricao" TEXT NOT NULL DEFAULT '',
    "foto_url" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "endereco" TEXT NOT NULL,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "denuncias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historico_status" (
    "id" TEXT NOT NULL,
    "denuncia_id" TEXT NOT NULL,
    "de" "StatusDenuncia" NOT NULL,
    "para" "StatusDenuncia" NOT NULL,
    "gestor_id" TEXT NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_status_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_municipio_id_cpf_key" ON "usuarios"("municipio_id", "cpf");

-- CreateIndex
CREATE UNIQUE INDEX "denuncias_protocolo_key" ON "denuncias"("protocolo");

-- CreateIndex
CREATE INDEX "denuncias_municipio_id_criada_em_idx" ON "denuncias"("municipio_id", "criada_em" DESC);

-- CreateIndex
CREATE INDEX "denuncias_autor_id_idx" ON "denuncias"("autor_id");

-- CreateIndex
CREATE INDEX "historico_status_denuncia_id_idx" ON "historico_status"("denuncia_id");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denuncias" ADD CONSTRAINT "denuncias_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denuncias" ADD CONSTRAINT "denuncias_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_status" ADD CONSTRAINT "historico_status_denuncia_id_fkey" FOREIGN KEY ("denuncia_id") REFERENCES "denuncias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_status" ADD CONSTRAINT "historico_status_gestor_id_fkey" FOREIGN KEY ("gestor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
