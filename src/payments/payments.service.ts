import { Injectable, RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsService {
  private stripe: any;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.stripe = new Stripe(this.configService.get<string>('STRIPE_SECRET_KEY') || '');
  }

  async createCheckoutSession(userId: string, planId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('Usuario no encontrado');

    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new Error('Plan no encontrado');

    if (Number(plan.price) === 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { subscriptionPlanId: plan.id },
      });
      return { url: `${this.configService.get('FRONTEND_URL') || 'http://localhost:3000'}/plans?success=true` };
    }

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: user.email,
      client_reference_id: userId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: plan.name,
              description: `Suscripción a ${plan.name} en SynData`,
            },
            unit_amount: Math.round(Number(plan.price) * 100), // Stripe usa centavos
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        planId: plan.id,
      },
      success_url: `${this.configService.get('FRONTEND_URL') || 'http://localhost:3000'}/plans?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.configService.get('FRONTEND_URL') || 'http://localhost:3000'}/plans?canceled=true`,
    });

    return { url: session.url };
  }

  async handleWebhook(signature: string, body: Buffer) {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');

    let event: any;

    try {
      event = this.stripe.webhooks.constructEvent(body, signature, webhookSecret || '');
    } catch (err: any) {
      console.error(`⚠️  Webhook signature verification failed.`, err.message);
      throw new Error('Webhook error');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const userId = session.client_reference_id;
      const planId = session.metadata?.planId;
      const subscriptionId = session.subscription as string;
      const customerId = session.customer as string;

      if (userId && planId) {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            subscriptionPlanId: planId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
          },
        });

        await this.prisma.paymentLog.create({
          data: {
            userId: userId,
            amount: session.amount_total ? session.amount_total / 100 : 0,
            currency: session.currency?.toUpperCase() || 'USD',
            status: 'SUCCESS',
            reference: session.id,
          },
        });
      }
    }

    return { received: true };
  }

  async verifySession(sessionId: string) {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status === 'paid') {
        const userId = session.client_reference_id;
        const planId = session.metadata?.planId;
        const subscriptionId = session.subscription as string;
        const customerId = session.customer as string;

        if (userId && planId) {
          const user = await this.prisma.user.findUnique({ where: { id: userId } });
          
          if (user?.subscriptionPlanId !== planId) {
            await this.prisma.user.update({
              where: { id: userId },
              data: {
                subscriptionPlanId: planId,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
              },
            });

            await this.prisma.paymentLog.create({
              data: {
                userId: userId,
                amount: session.amount_total ? session.amount_total / 100 : 0,
                currency: session.currency?.toUpperCase() || 'USD',
                status: 'SUCCESS',
                reference: session.id,
              },
            });
          }
        }
        return { success: true };
      }
      return { success: false };
    } catch (error) {
      console.error('Error verifying session:', error);
      return { success: false };
    }
  }
}
