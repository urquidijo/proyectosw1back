import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersService (HU17 - Dashboard de consumo del plan)', () => {
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
    subscriptionPlan: { findFirst: jest.Mock };
    project: { count: jest.Mock };
    workspace: { count: jest.Mock };
    generation: { findMany: jest.Mock };
  };
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
      subscriptionPlan: { findFirst: jest.fn() },
      project: { count: jest.fn() },
      workspace: { count: jest.fn() },
      generation: { findMany: jest.fn() },
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  it('calcula el consumo del plan: proyectos, workspaces, generaciones y filas generadas en el mes actual', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      apiKey: 'sk-syn-123',
      createdAt: new Date('2026-01-01'),
      plan: { id: 'pro1', name: 'Pro', maxGenerationsPerMonth: 100 },
    });
    prisma.project.count.mockResolvedValue(3);
    prisma.workspace.count.mockResolvedValue(1);
    prisma.generation.findMany.mockResolvedValue([
      { rowConfig: { clientes: 100, productos: 50 } },
      { rowConfig: { clientes: 25 } },
    ]);

    const result = await service.getUserUsage('u1');

    expect(result.plan.name).toBe('Pro');
    expect(result.apiKey).toBe('sk-syn-123');
    expect(result.usage.projects).toBe(3);
    expect(result.usage.workspaces).toBe(1);
    expect(result.usage.generations).toBe(2);
    expect(result.usage.rowsGenerated).toBe(175);
  });

  it('rechaza obtener el consumo de un usuario inexistente', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getUserUsage('inexistente')).rejects.toThrow(
      'Usuario no encontrado',
    );
  });

  it('genera y persiste una nueva API key para el usuario (consumo vía API)', async () => {
    const key = await service.generateApiKey('u1');
    expect(key).toMatch(/^sk-syn-/);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { apiKey: key },
    });
  });

  it('revoca la API key del usuario', async () => {
    await service.revokeApiKey('u1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { apiKey: null },
    });
  });

  it('asigna automáticamente el plan Free al crear un usuario nuevo', async () => {
    prisma.subscriptionPlan.findFirst.mockResolvedValue({
      id: 'free1',
      price: 0,
      isActive: true,
    });
    prisma.user.create.mockImplementation(({ data }: any) => ({
      id: 'u2',
      ...data,
    }));

    await service.create({
      name: 'Nuevo',
      email: 'nuevo@test.com',
      passwordHash: 'hash',
    } as any);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ plan: { connect: { id: 'free1' } } }),
    });
  });
});
