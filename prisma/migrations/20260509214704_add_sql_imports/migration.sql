-- CreateEnum
CREATE TYPE "SqlImportStatus" AS ENUM ('VALID', 'INVALID');

-- CreateTable
CREATE TABLE "sql_imports" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "originalSql" TEXT NOT NULL,
    "status" "SqlImportStatus" NOT NULL,
    "schemaJson" JSONB,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sql_imports_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "sql_imports" ADD CONSTRAINT "sql_imports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
