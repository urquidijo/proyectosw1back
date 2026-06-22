import { Injectable } from '@nestjs/common';
import { Prisma, User } from 'src/generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

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

  async generateApiKey(userId: string): Promise<string> {
    const key = `sk-syn-${crypto.randomBytes(24).toString('hex')}`;
    await this.prisma.user.update({
      where: { id: userId },
      data: { apiKey: key },
    });
    return key;
  }

  async revokeApiKey(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { apiKey: null },
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
    
    const generations = await this.prisma.generation.findMany({
      where: {
        project: { ownerId: userId },
        createdAt: { gte: startOfMonth },
      },
      select: { rowConfig: true },
    });

    const totalGenerations = generations.length;
    let totalRowsGenerated = 0;

    for (const gen of generations) {
      if (gen.rowConfig && typeof gen.rowConfig === 'object') {
        for (const val of Object.values(gen.rowConfig)) {
          totalRowsGenerated += Number(val) || 0;
        }
      }
    }

    return {
      plan: user.plan,
      apiKey: user.apiKey,
      usage: {
        projects: totalProjects,
        workspaces: totalWorkspaces,
        generations: totalGenerations,
        rowsGenerated: totalRowsGenerated,
      },
      subscriptionStart: user.createdAt,
    };
  }
}