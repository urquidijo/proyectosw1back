-- CreateTable
CREATE TABLE "generations" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sqlImportId" TEXT NOT NULL,
    "rowConfig" JSONB NOT NULL,
    "previewJson" JSONB NOT NULL,
    "outputSql" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "generations" ADD CONSTRAINT "generations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generations" ADD CONSTRAINT "generations_sqlImportId_fkey" FOREIGN KEY ("sqlImportId") REFERENCES "sql_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
