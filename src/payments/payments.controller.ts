import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  Res,
  RawBodyRequest,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create-checkout-session')
  async createCheckoutSession(
    @CurrentUser() user: any,
    @Body('planId') planId: string,
  ) {
    return this.paymentsService.createCheckoutSession(user.id, planId);
  }

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: any,
  ) {
    if (!signature) {
      throw new Error('Missing stripe-signature header');
    }
    
    // El rawBody está disponible porque configuramos rawBody: true en main.ts
    const raw = req.rawBody;
    if (!raw) {
      throw new Error('Missing raw body');
    }

    return this.paymentsService.handleWebhook(signature, raw);
  }

  @UseGuards(JwtAuthGuard)
  @Post('verify-session')
  async verifySession(
    @Body('sessionId') sessionId: string,
  ) {
    if (!sessionId) {
      throw new Error('Session ID is required');
    }
    return this.paymentsService.verifySession(sessionId);
  }
}
