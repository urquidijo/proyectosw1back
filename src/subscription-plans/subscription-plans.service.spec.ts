import { NotFoundException } from '@nestjs/common';
import { SubscriptionPlansService } from './subscription-plans.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SubscriptionPlansService (HU16 - Visualizar planes de suscripción)', () => {
  let prisma: {
    subscriptionPlan: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let service: SubscriptionPlansService;

  beforeEach(() => {
    prisma = {
      subscriptionPlan: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new SubscriptionPlansService(prisma as unknown as PrismaService);
  });

  it('crea un nuevo plan de suscripción', async () => {
    const dto = { name: 'Premium', price: 29.99 } as any;
    prisma.subscriptionPlan.create.mockResolvedValue({ id: 'p1', ...dto });

    const result = await service.create(dto);

    expect(result.id).toBe('p1');
    expect(prisma.subscriptionPlan.create).toHaveBeenCalledWith({ data: dto });
  });

  it('lista solo los planes activos ordenados por precio ascendente (Free, Pro, Premium)', async () => {
    await service.findAllActive();
    expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });
  });

  it('lista todos los planes (activos e inactivos) para administración', async () => {
    await service.findAll();
    expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
    });
  });

  it('obtiene un plan por id', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 'p1', name: 'Pro' });
    const result = await service.findOne('p1');
    expect(result.name).toBe('Pro');
  });

  it('lanza NotFoundException si el plan no existe', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(null);
    await expect(service.findOne('inexistente')).rejects.toThrow(NotFoundException);
  });

  it('actualiza los datos de un plan (precio, beneficios)', async () => {
    prisma.subscriptionPlan.update.mockResolvedValue({ id: 'p1', price: 19.99 });
    const result = await service.update('p1', { price: 19.99 });
    expect(result.price).toBe(19.99);
  });

  it('elimina un plan existente', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.subscriptionPlan.delete.mockResolvedValue({ id: 'p1' });

    const result = await service.remove('p1');

    expect(result.id).toBe('p1');
  });

  it('rechaza eliminar un plan que no existe', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(null);
    await expect(service.remove('inexistente')).rejects.toThrow(NotFoundException);
  });
});
