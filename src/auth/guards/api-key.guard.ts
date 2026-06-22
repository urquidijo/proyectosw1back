import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      throw new UnauthorizedException('API Key requerida. Incluye el header x-api-key.');
    }

    const user = await this.prisma.user.findUnique({
      where: { apiKey: apiKey as string },
      include: { plan: true },
    });

    if (!user) {
      throw new UnauthorizedException('API Key inválida o revocada.');
    }

    request.user = { id: user.id, email: user.email, role: user.role, plan: user.plan };
    return true;
  }
}
