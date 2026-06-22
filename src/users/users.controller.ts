import { Controller, Get, Post, Delete, Body, UseGuards, Request, ForbiddenException, ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService
  ) {}

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

  @UseGuards(JwtAuthGuard)
  @Get('me/usage')
  async getMyUsage(@Request() req) {
    return this.usersService.getUserUsage(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/api-key')
  async generateApiKey(@Request() req) {
    const key = await this.usersService.generateApiKey(req.user.id);
    return { apiKey: key };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/api-key')
  async revokeApiKey(@Request() req) {
    await this.usersService.revokeApiKey(req.user.id);
    return { message: 'API Key revocada correctamente.' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('superadmin')
  async createSuperAdmin(@Request() req, @Body() body: any) {
    if (req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Solo los administradores pueden crear nuevos SuperAdmins');
    }

    const { name, email, password } = body;
    if (!name || !email || !password) {
      throw new ConflictException('Nombre, email y contraseña son requeridos');
    }

    const emailLower = email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email: emailLower } });
    if (existing) {
      throw new ConflictException('El correo ya está registrado');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await this.prisma.user.create({
      data: {
        name: name.trim(),
        email: emailLower,
        passwordHash,
        role: 'SUPERADMIN',
      }
    });

    return { message: 'SuperAdmin creado con éxito', user: { id: newUser.id, email: newUser.email } };
  }
}
