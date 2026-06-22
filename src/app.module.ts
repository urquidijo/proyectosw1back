import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { SqlImportsModule } from './sql-imports/sql-imports.module';
import { GenerationsModule } from './generations/generations.module';
import { GenerationPlansModule } from './generation-plans/generation-plans.module';
import { SqlSchemaGeneratorModule } from './sql-schema-generator/sql-schema-generator.module';
import { GenerationRulesModule } from './generation-rules/generation-rules.module';
import { AiModule } from './ai/ai.module';
import { SubscriptionPlansModule } from './subscription-plans/subscription-plans.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { PaymentsModule } from './payments/payments.module';
import { CommunityModule } from './community/community.module';
import { ExternalApiModule } from './external-api/external-api.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AiModule,
    PrismaModule,
    UsersModule,
    AuthModule,
    ProjectsModule,
    SqlImportsModule,
    GenerationsModule,
    GenerationPlansModule,
    SqlSchemaGeneratorModule,
    GenerationRulesModule,
    SubscriptionPlansModule,
    WorkspacesModule,
    PaymentsModule,
    CommunityModule,
    ExternalApiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }