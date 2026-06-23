-- CreateEnum
CREATE TYPE "SqlDialect" AS ENUM ('POSTGRESQL', 'MYSQL');

-- AlterTable
ALTER TABLE "sql_imports" ADD COLUMN     "dialect" "SqlDialect" NOT NULL DEFAULT 'POSTGRESQL';
