-- AlterTable
ALTER TABLE "generations" ADD COLUMN     "generationRuleSetId" TEXT;

-- CreateTable
CREATE TABLE "generation_rule_sets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sqlImportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rulesJson" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generation_rule_sets_projectId_idx" ON "generation_rule_sets"("projectId");

-- CreateIndex
CREATE INDEX "generation_rule_sets_sqlImportId_idx" ON "generation_rule_sets"("sqlImportId");

-- CreateIndex
CREATE UNIQUE INDEX "generation_rule_sets_projectId_sqlImportId_name_key" ON "generation_rule_sets"("projectId", "sqlImportId", "name");

-- AddForeignKey
ALTER TABLE "generations" ADD CONSTRAINT "generations_generationRuleSetId_fkey" FOREIGN KEY ("generationRuleSetId") REFERENCES "generation_rule_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_rule_sets" ADD CONSTRAINT "generation_rule_sets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_rule_sets" ADD CONSTRAINT "generation_rule_sets_sqlImportId_fkey" FOREIGN KEY ("sqlImportId") REFERENCES "sql_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
