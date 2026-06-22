import { Module } from '@nestjs/common';
import { GenerationsModule } from '../generations/generations.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [GenerationsModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
