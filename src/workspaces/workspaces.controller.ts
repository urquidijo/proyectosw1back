import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto, AddMemberDto } from './dto/workspace.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('groups')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  create(@Request() req, @Body() createDto: CreateWorkspaceDto) {
    return this.workspacesService.create(req.user.id, createDto);
  }

  @Get()
  findAll(@Request() req) {
    return this.workspacesService.findMyWorkspaces(req.user.id);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.workspacesService.findOne(id, req.user.id);
  }

  @Post(':id/members')
  addMember(@Request() req, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.workspacesService.addMember(id, req.user.id, dto);
  }
}
