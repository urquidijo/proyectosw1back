-- CreateTable
CREATE TABLE "generation_plans" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sqlImportId" TEXT NOT NULL,
    "planJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "generation_plans_sqlImportId_key" ON "generation_plans"("sqlImportId");

-- AddForeignKey
ALTER TABLE "generation_plans" ADD CONSTRAINT "generation_plans_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_plans" ADD CONSTRAINT "generation_plans_sqlImportId_fkey" FOREIGN KEY ("sqlImportId") REFERENCES "sql_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
