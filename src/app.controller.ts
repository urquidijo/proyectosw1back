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
}
