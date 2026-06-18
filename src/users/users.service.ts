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
}