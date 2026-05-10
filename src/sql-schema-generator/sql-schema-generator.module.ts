import { Module } from '@nestjs/common';
import { SqlSchemaGeneratorController } from './sql-schema-generator.controller';
import { SqlSchemaGeneratorService } from './sql-schema-generator.service';

@Module({
  controllers: [SqlSchemaGeneratorController],
  providers: [SqlSchemaGeneratorService],
})
export class SqlSchemaGeneratorModule {}