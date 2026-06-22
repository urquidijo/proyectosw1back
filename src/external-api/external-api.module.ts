import { Module } from '@nestjs/common';
import { ExternalApiController } from './external-api.controller';
import { ExternalApiService } from './external-api.service';
import { GenerationsModule } from '../generations/generations.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [GenerationsModule, PrismaModule],
  controllers: [ExternalApiController],
  providers: [ExternalApiService],
})
export class ExternalApiModule {}
