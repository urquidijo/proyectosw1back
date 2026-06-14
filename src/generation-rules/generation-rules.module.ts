import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GenerationRulesController } from './generation-rules.controller';
import { GenerationRulesService } from './generation-rules.service';

@Module({
    imports: [PrismaModule],
    controllers: [GenerationRulesController],
    providers: [GenerationRulesService],
    exports: [GenerationRulesService],
})
export class GenerationRulesModule { }