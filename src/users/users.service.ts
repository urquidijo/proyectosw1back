import { Injectable } from '@nestjs/common';
import { Prisma, User } from 'src/generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<any> {
    return this.prisma.user.findUnique({
      where: { id },
      include: { plan: true },
    });
  }

  async findByEmail(email: string): Promise<any> {
    return this.prisma.user.findUnique({
      where: { email },
      include: { plan: true },
    });
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    const freePlan = await this.prisma.subscriptionPlan.findFirst({
      where: { price: 0, isActive: true },
    });

    if (freePlan) {
      data.plan = { connect: { id: freePlan.id } };
    }

    return this.prisma.user.create({
      data,
    });
  }

  async getUserUsage(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { plan: true },
    });

    if (!user) throw new Error('Usuario no encontrado');

    const totalProjects = await this.prisma.project.count({
      where: { ownerId: userId },
    });

    const totalWorkspaces = await this.prisma.workspace.count({
      where: { ownerId: userId },
    });

    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    
    const totalGenerations = await this.prisma.generation.count({
      where: {
        project: { ownerId: userId },
        createdAt: { gte: startOfMonth },
      },
    });

    return {
      plan: user.plan,
      usage: {
        projects: totalProjects,
        workspaces: totalWorkspaces,
        generations: totalGenerations,
      },
      subscriptionStart: user.createdAt,
    };
  }
}