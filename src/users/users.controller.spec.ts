import { ForbiddenException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersController (HU14 - Panel de administración de usuarios)', () => {
  let prisma: {
    user: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
  };
  let usersService: {
    getUserUsage: jest.Mock;
    generateApiKey: jest.Mock;
    revokeApiKey: jest.Mock;
  };
  let controller: UsersController;

  beforeEach(() => {
    prisma = {
      user: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    };
    usersService = {
      getUserUsage: jest.fn(),
      generateApiKey: jest.fn(),
      revokeApiKey: jest.fn(),
    };
    controller = new UsersController(
      prisma as unknown as PrismaService,
      usersService as unknown as UsersService,
    );
  });

  it('permite a un SUPERADMIN listar todos los usuarios con su plan', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    const req = { user: { role: 'SUPERADMIN' } };

    const result = await controller.findAll(req);

    expect(result).toHaveLength(2);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('rechaza listar usuarios si el solicitante no es SUPERADMIN', async () => {
    const req = { user: { role: 'USER' } };
    await expect(controller.findAll(req)).rejects.toThrow(ForbiddenException);
  });

  it('permite a un SUPERADMIN crear otro SUPERADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'u3', email: 'nuevo@admin.com' });
    const req = { user: { role: 'SUPERADMIN' } };

    const result = await controller.createSuperAdmin(req, {
      name: 'Nuevo Admin',
      email: 'Nuevo@Admin.com',
      password: 'secreta123',
    });

    expect(result.user.email).toBe('nuevo@admin.com');
    expect(prisma.user.create).toHaveBeenCalled();
    const createdData = prisma.user.create.mock.calls[0][0].data;
    expect(await bcrypt.compare('secreta123', createdData.passwordHash)).toBe(
      true,
    );
  });

  it('rechaza crear un SUPERADMIN si el solicitante no lo es', async () => {
    const req = { user: { role: 'USER' } };
    await expect(
      controller.createSuperAdmin(req, {
        name: 'x',
        email: 'x@x.com',
        password: 'x',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rechaza crear un SUPERADMIN si el correo ya está registrado', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
    const req = { user: { role: 'SUPERADMIN' } };

    await expect(
      controller.createSuperAdmin(req, {
        name: 'x',
        email: 'dup@admin.com',
        password: 'x',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('expone el consumo del plan del usuario autenticado (HU17)', async () => {
    usersService.getUserUsage.mockResolvedValue({ usage: { projects: 1 } });
    const req = { user: { id: 'u1' } };

    const result = await controller.getMyUsage(req);

    expect(usersService.getUserUsage).toHaveBeenCalledWith('u1');
    expect(result.usage.projects).toBe(1);
  });
});
