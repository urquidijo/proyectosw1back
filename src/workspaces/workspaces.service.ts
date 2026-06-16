import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateWorkspaceDto, AddMemberDto } from './dto/workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
  ) {}

  async create(userId: string, dto: CreateWorkspaceDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        plan: true,
        ownedWorkspaces: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const maxWorkspaces = user.plan?.maxWorkspaces ?? 1;

    if (user.ownedWorkspaces.length >= maxWorkspaces) {
      throw new BadRequestException('Has alcanzado el límite de grupos para tu plan actual. Por favor actualiza tu suscripción.');
    }

    return this.prisma.workspace.create({
      data: {
        name: dto.name,
        ownerId: userId,
        members: {
          create: {
            userId,
            role: 'ADMIN',
          },
        },
      },
      include: {
        members: true,
      },
    });
  }

  async findMyWorkspaces(userId: string) {
    return this.prisma.workspace.findMany({
      where: {
        members: { some: { userId } },
      },
      include: {
        owner: { include: { plan: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        projects: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: {
        id,
        members: { some: { userId } },
      },
      include: {
        owner: { include: { plan: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        projects: {
          include: {
            owner: { select: { name: true } },
          },
        },
      },
    });

    if (!workspace) throw new NotFoundException('Workspace no encontrado');
    return workspace;
  }

  async addMember(workspaceId: string, adminId: string, dto: AddMemberDto) {
    // Verificar que el adminId es admin del workspace
    const adminMember = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: adminId } },
    });

    if (!adminMember || adminMember.role !== 'ADMIN') {
      throw new ConflictException('No tienes permiso para añadir miembros');
    }

    // Buscar al usuario por correo
    const userToAdd = await this.usersService.findByEmail(dto.email);
    if (!userToAdd) {
      throw new NotFoundException('El usuario con ese correo no está registrado en SynData');
    }

    // Comprobar límite del plan del owner del workspace
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { owner: { include: { plan: true } }, members: true },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace no encontrado');
    }

    const maxUsers = workspace.owner.plan?.maxUsersPerWorkspace ?? 3;

    if (workspace.members.length >= maxUsers) {
      throw new BadRequestException('El plan de este grupo no permite más usuarios. El administrador debe actualizar su suscripción.');
    }

    try {
      return await this.prisma.workspaceMember.create({
        data: {
          workspaceId,
          userId: userToAdd.id,
          role: 'MEMBER',
        },
      });
    } catch (e) {
      throw new ConflictException('El usuario ya pertenece a este grupo');
    }
  }
}
