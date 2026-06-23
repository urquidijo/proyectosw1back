-- CreateEnum
CREATE TYPE "GenerationEngine" AS ENUM ('POSTGRESQL', 'MONGODB');

-- AlterTable
ALTER TABLE "generations" ADD COLUMN     "engine" "GenerationEngine" NOT NULL DEFAULT 'POSTGRESQL';
