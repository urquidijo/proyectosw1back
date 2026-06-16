import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, createProjectDto: CreateProjectDto) {
    return this.prisma.project.create({
      data: {
        name: createProjectDto.name.trim(),
        description: createProjectDto.description?.trim() || null,
        owner: {
          connect: {
            id: ownerId,
          },
        },
      },
    });
  }

  async findMyProjects(userId: string) {
    return this.prisma.project.findMany({
      where: {
        OR: [
          { ownerId: userId },
          { workspace: { members: { some: { userId } } } },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string, userId: string) {
    const project = await this.prisma.project.findFirst({
      where: {
        id,
        OR: [
          { ownerId: userId },
          { workspace: { members: { some: { userId } } } },
        ],
      },
    });

    if (!project) {
      throw new NotFoundException('Proyecto no encontrado');
    }

    return project;
  }

  async remove(id: string, ownerId: string) {
    await this.findOne(id, ownerId);

    await this.prisma.project.delete({
      where: {
        id,
      },
    });

    return {
      message: 'Proyecto eliminado correctamente',
    };
  }

  async assignToWorkspace(projectId: string, workspaceId: string, ownerId: string) {
    // Verificar que el proyecto es del owner
    await this.findOne(projectId, ownerId);

    // Verificar que el usuario pertenece al workspace
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: ownerId } },
    });

    if (!member) {
      throw new NotFoundException('No perteneces a este grupo');
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: { workspaceId },
    });
  }
}