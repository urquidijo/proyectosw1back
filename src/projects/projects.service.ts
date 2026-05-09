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

  async findMyProjects(ownerId: string) {
    return this.prisma.project.findMany({
      where: {
        ownerId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string, ownerId: string) {
    const project = await this.prisma.project.findFirst({
      where: {
        id,
        ownerId,
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
}