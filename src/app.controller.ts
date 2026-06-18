import { Controller, Get, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @UseGuards(JwtAuthGuard)
  @Get('logs/all')
  async getAllLogs(@Request() req) {
    if (req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('No tienes permiso para ver los logs');
    }
    const [activities, payments] = await Promise.all([
      this.prisma.activityLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { user: { select: { email: true } }, workspace: { select: { name: true } } }
      }),
      this.prisma.paymentLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { user: { select: { email: true } } }
      }),
    ]);
    return { activities, payments };
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/kpis')
  async getKpis(@Request() req) {
    if (req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('No tienes permiso para ver los KPIs');
    }

    const [allUsers, totalProjects, allGenerations, allPayments] = await Promise.all([
      this.prisma.user.findMany({ select: { createdAt: true } }),
      this.prisma.project.count(),
      this.prisma.generation.findMany({ select: { createdAt: true } }),
      this.prisma.paymentLog.findMany({
        where: { status: 'SUCCESS' },
        select: { amount: true, createdAt: true },
      }),
    ]);

    const totalUsers = allUsers.length;
    const totalGenerations = allGenerations.length;
    const totalRevenue = allPayments.reduce((sum, p) => sum + Number(p.amount), 0);

    // Derived Data for Charts
    const revenueDataMap = new Map<string, number>();
    allPayments.forEach(p => {
      const date = new Date(p.createdAt);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      revenueDataMap.set(month, (revenueDataMap.get(month) || 0) + Number(p.amount));
    });
    const revenueData = Array.from(revenueDataMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, amount]) => ({ month, amount }));

    const usersDataMap = new Map<string, number>();
    allUsers.forEach(u => {
      const date = new Date(u.createdAt);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      usersDataMap.set(month, (usersDataMap.get(month) || 0) + 1);
    });
    const usersData = Array.from(usersDataMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, users]) => ({ month, users }));

    const generationsDataMap = new Map<string, number>();
    allGenerations.forEach(g => {
      const date = new Date(g.createdAt);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      generationsDataMap.set(day, (generationsDataMap.get(day) || 0) + 1);
    });
    const generationsData = Array.from(generationsDataMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14) // últimos 14 días con actividad
      .map(([day, generations]) => ({ day, generations }));

    return {
      totalUsers,
      totalProjects,
      totalGenerations,
      totalRevenue,
      revenueData,
      usersData,
      generationsData,
    };
  }
}
