import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { SqlImportsModule } from './sql-imports/sql-imports.module';
import { GenerationsModule } from './generations/generations.module';
import { GenerationPlansModule } from './generation-plans/generation-plans.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    ProjectsModule,
    SqlImportsModule,
    GenerationsModule,
    GenerationPlansModule,
  ],
})
export class AppModule {}