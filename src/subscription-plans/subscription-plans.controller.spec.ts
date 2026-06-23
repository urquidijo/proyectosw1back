import { ForbiddenException } from '@nestjs/common';
import { SubscriptionPlansController } from './subscription-plans.controller';
import { SubscriptionPlansService } from './subscription-plans.service';

describe('SubscriptionPlansController (HU16 - Planes / HU14 - Admin de planes)', () => {
  let plansService: {
    findAllActive: jest.Mock;
    findAll: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };
  let controller: SubscriptionPlansController;

  beforeEach(() => {
    plansService = {
      findAllActive: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new SubscriptionPlansController(
      plansService as unknown as SubscriptionPlansService,
    );
  });

  it('lista los planes activos públicamente (sin autenticación) para la landing page', async () => {
    plansService.findAllActive.mockResolvedValue([
      { id: 'free1', name: 'Free', price: 0 },
      { id: 'pro1', name: 'Pro', price: 9.99 },
    ]);

    const result = await controller.findAllActive();

    expect(result).toHaveLength(2);
    expect(plansService.findAllActive).toHaveBeenCalled();
  });

  it('permite a un SUPERADMIN ver todos los planes (activos e inactivos)', async () => {
    plansService.findAll.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    const req = { user: { role: 'SUPERADMIN' } };

    const result = await controller.findAll(req);

    expect(result).toHaveLength(2);
  });

  it('rechaza a un usuario que no es SUPERADMIN al listar todos los planes', () => {
    const req = { user: { role: 'USER' } };
    expect(() => controller.findAll(req)).toThrow(ForbiddenException);
  });

  it('permite a un SUPERADMIN crear un nuevo plan', async () => {
    const req = { user: { role: 'SUPERADMIN' } };
    const dto = { name: 'Premium', price: 29.99 } as any;
    plansService.create.mockResolvedValue({ id: 'prem1', ...dto });

    const result = await controller.create(req, dto);

    expect(plansService.create).toHaveBeenCalledWith(dto);
    expect(result.name).toBe('Premium');
  });

  it('rechaza crear un plan si el usuario no es SUPERADMIN', () => {
    const req = { user: { role: 'USER' } };
    expect(() => controller.create(req, { name: 'Hack' } as any)).toThrow(
      ForbiddenException,
    );
    expect(plansService.create).not.toHaveBeenCalled();
  });

  it('permite a un SUPERADMIN editar un plan existente', async () => {
    const req = { user: { role: 'SUPERADMIN' } };
    plansService.update.mockResolvedValue({ id: 'pro1', price: 14.99 });

    const result = await controller.update(req, 'pro1', { price: 14.99 });

    expect(plansService.update).toHaveBeenCalledWith('pro1', { price: 14.99 });
    expect(result.price).toBe(14.99);
  });

  it('permite a un SUPERADMIN eliminar un plan', async () => {
    const req = { user: { role: 'SUPERADMIN' } };
    plansService.remove.mockResolvedValue({ id: 'pro1' });

    const result = await controller.remove(req, 'pro1');

    expect(plansService.remove).toHaveBeenCalledWith('pro1');
    expect(result.id).toBe('pro1');
  });

  it('rechaza eliminar un plan si el usuario no es SUPERADMIN', () => {
    const req = { user: { role: 'USER' } };
    expect(() => controller.remove(req, 'pro1')).toThrow(ForbiddenException);
  });
});
