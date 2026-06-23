import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { CommunityService } from './community.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed-url.example.com/file'),
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'fixed-uuid'),
}));

describe('CommunityService (HU18 - Comunidad de desarrolladores)', () => {
  let prisma: {
    communityPost: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    postUpvote: { findUnique: jest.Mock; create: jest.Mock; delete: jest.Mock };
    postComment: { create: jest.Mock; findUnique: jest.Mock; delete: jest.Mock };
  };
  let configService: { getOrThrow: jest.Mock };
  let service: CommunityService;

  beforeEach(() => {
    prisma = {
      communityPost: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      postUpvote: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      postComment: {
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    configService = {
      getOrThrow: jest.fn().mockReturnValue('fake-credential'),
    };
    service = new CommunityService(
      prisma as unknown as PrismaService,
      configService as unknown as ConfigService,
    );
  });

  it('lista posts públicos filtrando por búsqueda y devolviendo conteo de comentarios/upvotes', async () => {
    prisma.communityPost.findMany.mockResolvedValue([
      {
        id: 'post1',
        title: 'Generador de clientes ficticios',
        imageKey: null,
        _count: { comments: 3, upvotes: 5 },
      },
    ]);

    const result = await service.getPosts('clientes', undefined);

    expect(prisma.communityPost.findMany).toHaveBeenCalled();
    expect(result[0].commentCount).toBe(3);
    expect(result[0].upvoteCount).toBe(5);
  });

  it('publica un post con archivo SQL e imagen, subiéndolos a S3', async () => {
    prisma.communityPost.create.mockImplementation(({ data }: any) => ({
      id: 'post1',
      ...data,
    }));

    const sqlFile = {
      buffer: Buffer.from('SELECT 1;'),
      originalname: 'dump.sql',
      mimetype: 'text/plain',
    } as Express.Multer.File;
    const imageFile = {
      buffer: Buffer.from('img'),
      originalname: 'foto.png',
      mimetype: 'image/png',
    } as Express.Multer.File;

    const result = await service.createPost(
      'u1',
      { title: 'Mi post', description: 'desc', tags: ['sql'] },
      sqlFile,
      imageFile,
    );

    expect(result.fileKey).toMatch(/^files\/.+\.sql$/);
    expect(result.imageKey).toMatch(/^images\/.+\.png$/);
    expect(prisma.communityPost.create).toHaveBeenCalled();
  });

  it('rechaza eliminar un post de otro autor si no es SUPERADMIN', async () => {
    prisma.communityPost.findUnique.mockResolvedValue({
      id: 'post1',
      authorId: 'otroUsuario',
      fileKey: null,
      imageKey: null,
    });

    await expect(service.deletePost('post1', 'u1', 'USER')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('permite a un SUPERADMIN eliminar el post de otro usuario', async () => {
    prisma.communityPost.findUnique.mockResolvedValue({
      id: 'post1',
      authorId: 'otroUsuario',
      fileKey: null,
      imageKey: null,
    });
    prisma.communityPost.delete.mockResolvedValue({ id: 'post1' });

    const result = await service.deletePost('post1', 'admin1', 'SUPERADMIN');
    expect(result.id).toBe('post1');
  });

  it('lanza NotFoundException si el post a eliminar no existe', async () => {
    prisma.communityPost.findUnique.mockResolvedValue(null);
    await expect(
      service.deletePost('inexistente', 'u1', 'USER'),
    ).rejects.toThrow(NotFoundException);
  });

  it('alterna el upvote: lo agrega si no existe y lo quita si ya existe', async () => {
    prisma.postUpvote.findUnique.mockResolvedValueOnce(null);
    let result = await service.toggleUpvote('post1', 'u1');
    expect(result.upvoted).toBe(true);
    expect(prisma.postUpvote.create).toHaveBeenCalledWith({
      data: { postId: 'post1', userId: 'u1' },
    });

    prisma.postUpvote.findUnique.mockResolvedValueOnce({
      postId: 'post1',
      userId: 'u1',
    });
    result = await service.toggleUpvote('post1', 'u1');
    expect(result.upvoted).toBe(false);
  });

  it('agrega un comentario a un post existente', async () => {
    prisma.communityPost.findUnique.mockResolvedValue({ id: 'post1' });
    prisma.postComment.create.mockResolvedValue({
      id: 'c1',
      postId: 'post1',
      content: 'Excelente',
    });

    const result = await service.addComment('post1', 'u1', 'Excelente');
    expect(result.content).toBe('Excelente');
  });

  it('rechaza comentar un post que no existe', async () => {
    prisma.communityPost.findUnique.mockResolvedValue(null);
    await expect(service.addComment('inexistente', 'u1', 'hola')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rechaza eliminar el comentario de otro usuario si no es SUPERADMIN', async () => {
    prisma.postComment.findUnique.mockResolvedValue({ id: 'c1', authorId: 'otro' });
    await expect(service.deleteComment('c1', 'u1', 'USER')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lista todos los posts para el panel de administración (HU14)', async () => {
    prisma.communityPost.findMany.mockResolvedValue([
      { id: 'post1', _count: { comments: 1, upvotes: 2 } },
    ]);
    const result = await service.getAllPostsAdmin();
    expect(result[0].commentCount).toBe(1);
    expect(result[0].upvoteCount).toBe(2);
  });
});
