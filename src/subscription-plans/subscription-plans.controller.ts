import { Controller, Get, Post, Put, Body, Param, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { SubscriptionPlansService } from './subscription-plans.service';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('plans')
export class SubscriptionPlansController {
  constructor(private readonly plansService: SubscriptionPlansService) {}

  // Público: Para la Landing Page
  @Get()
  findAllActive() {
    return this.plansService.findAllActive();
  }

  // Privado: Solo para SuperAdmin
  @UseGuards(JwtAuthGuard)
  @Get('all')
  findAll(@Request() req) {
    if (req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Solo Superadmin puede ver todos los planes');
    }
    return this.plansService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Request() req, @Body() createDto: CreateSubscriptionPlanDto) {
    if (req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Solo Superadmin puede crear planes');
    }
    return this.plansService.create(createDto);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(@Request() req, @Param('id') id: string, @Body() updateDto: Partial<CreateSubscriptionPlanDto>) {
    if (req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Solo Superadmin puede editar planes');
    }
    return this.plansService.update(id, updateDto);
  }
}
