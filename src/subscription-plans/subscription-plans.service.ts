import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { Prisma } from '../generated/prisma/client';

@Injectable()
export class SubscriptionPlansService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateSubscriptionPlanDto) {
    return this.prisma.subscriptionPlan.create({
      data: createDto as unknown as Prisma.SubscriptionPlanCreateInput,
    });
  }

  async findAllActive() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });
  }

  async findAll() {
    return this.prisma.subscriptionPlan.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return plan;
  }

  async update(id: string, updateDto: Partial<CreateSubscriptionPlanDto>) {
    return this.prisma.subscriptionPlan.update({
      where: { id },
      data: updateDto as unknown as Prisma.SubscriptionPlanUpdateInput,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.subscriptionPlan.delete({
      where: { id },
    });
  }
}
