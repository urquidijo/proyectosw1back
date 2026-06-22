import {
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GenerationsService } from '../generations/generations.service';
import { CreateGenerationDto } from '../generations/dto/create-generation.dto';

@Injectable()
export class ExternalApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly generationsService: GenerationsService,
  ) {}

  async generate(
    userId: string,
    projectId: string,
    dto: CreateGenerationDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { plan: true },
    });

    if (!user) {
      throw new ForbiddenException('Usuario no encontrado.');
    }

    const maxGenerations = user.plan?.maxGenerationsPerMonth ?? 10;

    const startOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    );

    const usedThisMonth = await this.prisma.generation.count({
      where: {
        project: { ownerId: userId },
        createdAt: { gte: startOfMonth },
      },
    });

    if (usedThisMonth >= maxGenerations) {
      throw new ForbiddenException(
        `Has alcanzado el límite de ${maxGenerations} generaciones del plan "${user.plan?.name ?? 'Free'}". Actualiza tu plan para continuar.`,
      );
    }

    return this.generationsService.create(projectId, userId, dto);
  }
  async listProjects(userId: string) {
    return this.prisma.project.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true, description: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listImports(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ownerId: userId },
    });
    if (!project) throw new Error('Proyecto no encontrado o no pertenece a este usuario.');

    return this.prisma.sqlImport.findMany({
      where: { projectId },
      select: { id: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getGenerationStatus(userId: string, generationId: string) {
    const generation = await this.prisma.generation.findUnique({
      where: { id: generationId },
      include: { project: true },
    });

    if (!generation || generation.project.ownerId !== userId) {
      throw new ForbiddenException('Generación no encontrada o acceso denegado.');
    }

    return {
      id: generation.id,
      status: generation.status,
      progress: generation.progress,
      previewJson: generation.previewJson,
      createdAt: generation.createdAt,
    };
  }
}
