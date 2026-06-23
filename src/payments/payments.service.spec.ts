import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('PaymentsService (HU15 - Pago de planes de suscripción)', () => {
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    subscriptionPlan: { findUnique: jest.Mock };
    paymentLog: { create: jest.Mock };
  };
  let configService: { get: jest.Mock };
  let service: PaymentsService;
  let stripeMock: {
    checkout: { sessions: { create: jest.Mock; retrieve: jest.Mock } };
    webhooks: { constructEvent: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      subscriptionPlan: { findUnique: jest.fn() },
      paymentLog: { create: jest.fn() },
    };
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_fake_key';
        if (key === 'FRONTEND_URL') return 'http://localhost:3000';
        if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_test';
        return '';
      }),
    };

    service = new PaymentsService(
      configService as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );

    stripeMock = {
      checkout: { sessions: { create: jest.fn(), retrieve: jest.fn() } },
      webhooks: { constructEvent: jest.fn() },
    };
    (service as any).stripe = stripeMock;
  });

  it('activa directamente el plan gratuito sin pasar por Stripe', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@a.com' });
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'free1',
      name: 'Free',
      price: 0,
    });

    const result = await service.createCheckoutSession('u1', 'free1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { subscriptionPlanId: 'free1' },
    });
    expect(result.url).toContain('success=true');
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('crea una sesión de checkout de Stripe para un plan de pago', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@a.com' });
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'pro1',
      name: 'Pro',
      price: 9.99,
    });
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout.stripe.com/session123',
    });

    const result = await service.createCheckoutSession('u1', 'pro1');

    expect(stripeMock.checkout.sessions.create).toHaveBeenCalled();
    const callArgs = stripeMock.checkout.sessions.create.mock.calls[0][0];
    expect(callArgs.line_items[0].price_data.unit_amount).toBe(999);
    expect(callArgs.metadata.planId).toBe('pro1');
    expect(result.url).toBe('https://checkout.stripe.com/session123');
  });

  it('rechaza el checkout si el usuario no existe', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.createCheckoutSession('inexistente', 'pro1'),
    ).rejects.toThrow('Usuario no encontrado');
  });

  it('rechaza el checkout si el plan no existe', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.subscriptionPlan.findUnique.mockResolvedValue(null);
    await expect(
      service.createCheckoutSession('u1', 'inexistente'),
    ).rejects.toThrow('Plan no encontrado');
  });

  it('procesa el webhook checkout.session.completed actualizando el plan del usuario y registrando el pago', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'u1',
          metadata: { planId: 'pro1' },
          subscription: 'sub_123',
          customer: 'cus_123',
          amount_total: 999,
          currency: 'usd',
          id: 'sess_123',
        },
      },
    });

    const result = await service.handleWebhook('sig_test', Buffer.from('{}'));

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        subscriptionPlanId: 'pro1',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
      },
    });
    expect(prisma.paymentLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        amount: 9.99,
        currency: 'USD',
        status: 'SUCCESS',
        reference: 'sess_123',
      },
    });
    expect(result).toEqual({ received: true });
  });

  it('rechaza el webhook si la firma de Stripe es inválida', async () => {
    stripeMock.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    await expect(
      service.handleWebhook('firma-invalida', Buffer.from('{}')),
    ).rejects.toThrow('Webhook error');
  });

  it('verifica una sesión pagada y actualiza el plan si aún no coincide', async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      payment_status: 'paid',
      client_reference_id: 'u1',
      metadata: { planId: 'pro1' },
      subscription: 'sub_123',
      customer: 'cus_123',
      amount_total: 999,
      currency: 'usd',
      id: 'sess_123',
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', subscriptionPlanId: 'free1' });

    const result = await service.verifySession('sess_123');

    expect(result).toEqual({ success: true });
    expect(prisma.user.update).toHaveBeenCalled();
    expect(prisma.paymentLog.create).toHaveBeenCalled();
  });

  it('no duplica la actualización si el usuario ya tiene asignado ese plan', async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      payment_status: 'paid',
      client_reference_id: 'u1',
      metadata: { planId: 'pro1' },
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', subscriptionPlanId: 'pro1' });

    const result = await service.verifySession('sess_123');

    expect(result).toEqual({ success: true });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('retorna success:false si la sesión no fue pagada', async () => {
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      payment_status: 'unpaid',
    });
    const result = await service.verifySession('sess_123');
    expect(result).toEqual({ success: false });
  });
});
