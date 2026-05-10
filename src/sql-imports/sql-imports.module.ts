import { Module } from '@nestjs/common';
import { SqlImportsController } from './sql-imports.controller';
import { SqlImportsService } from './sql-imports.service';
import { SqlSchemaAnalyzerService } from './sql-schema-analyzer.service';

@Module({
  controllers: [SqlImportsController],
  providers: [SqlImportsService, SqlSchemaAnalyzerService],
})
export class SqlImportsModule {}