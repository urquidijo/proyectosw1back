import { Controller, Get, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @UseGuards(JwtAuthGuard)
  @Get('all')
  async findAll(@Request() req) {
    if (req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('No tienes permiso para ver los usuarios');
    }
    return this.prisma.user.findMany({
      include: {
        plan: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
