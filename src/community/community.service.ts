import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CommunityService {
  private s3: S3Client;
  private bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.bucket = 'syndata-community-doc';
    this.s3 = new S3Client({
      region: 'us-east-2',
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('CLAVE_ACCESO'),
        secretAccessKey: this.config.getOrThrow<string>('CLAVE_SECRETA'),
      },
    });
  }

  // ---- S3 Helpers ----

  async uploadToS3(
    buffer: Buffer,
    originalName: string,
    mimetype: string,
    folder: 'files' | 'images',
  ): Promise<string> {
    const ext = originalName.split('.').pop();
    const key = `${folder}/${uuidv4()}.${ext}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      }),
    );
    return key;
  }

  async getSignedDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: 300 }); // 5 min
  }

  async deleteFromS3(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  // ---- Posts ----

  async getPosts(search?: string, tag?: string) {
    const posts = await this.prisma.communityPost.findMany({
      where: {
        AND: [
          search
            ? {
                OR: [
                  { title: { contains: search, mode: 'insensitive' } },
                  { description: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {},
          tag ? { tags: { has: tag } } : {},
        ],
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
        _count: { select: { comments: true, upvotes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const postsWithUrls = await Promise.all(
      posts.map(async (p) => ({
        ...p,
        imageUrl: p.imageKey ? await this.getSignedDownloadUrl(p.imageKey) : null,
        upvoteCount: p._count.upvotes,
        commentCount: p._count.comments,
      }))
    );
    return postsWithUrls;
  }

  async getPostById(id: string, userId?: string) {
    const post = await this.prisma.communityPost.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true, email: true } },
        comments: {
          include: {
            author: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { upvotes: true } },
        upvotes: userId ? { where: { userId } } : false,
      },
    });

    if (!post) throw new NotFoundException('Post no encontrado');

    let imageUrl: string | null = null;
    if (post.imageKey) {
      imageUrl = await this.getSignedDownloadUrl(post.imageKey);
    }

    return {
      ...post,
      imageUrl,
      upvoteCount: post._count.upvotes,
      userHasUpvoted: userId ? post.upvotes.length > 0 : false,
    };
  }

  async createPost(
    authorId: string,
    data: {
      title: string;
      description: string;
      tags: string[];
      projectId?: string;
    },
    sqlFile?: Express.Multer.File,
    imageFile?: Express.Multer.File,
  ) {
    let fileKey: string | undefined;
    let imageKey: string | undefined;

    if (sqlFile) {
      fileKey = await this.uploadToS3(
        sqlFile.buffer,
        sqlFile.originalname,
        sqlFile.mimetype,
        'files',
      );
    }

    if (imageFile) {
      imageKey = await this.uploadToS3(
        imageFile.buffer,
        imageFile.originalname,
        imageFile.mimetype,
        'images',
      );
    }

    return this.prisma.communityPost.create({
      data: {
        title: data.title,
        description: data.description,
        tags: data.tags,
        fileKey,
        imageKey,
        authorId,
        ...(data.projectId ? { projectId: data.projectId } : {}),
      },
      include: {
        author: { select: { id: true, name: true } },
      },
    });
  }

  async deletePost(postId: string, userId: string, userRole?: string) {
    const post = await this.prisma.communityPost.findUnique({
      where: { id: postId },
    });
    if (!post) throw new NotFoundException('Post no encontrado');

    // Allow if author or SUPERADMIN
    const isSuperAdmin = userRole === 'SUPERADMIN';
    if (post.authorId !== userId && !isSuperAdmin)
      throw new ForbiddenException('No puedes eliminar este post');

    if (post.fileKey) await this.deleteFromS3(post.fileKey);
    if (post.imageKey) await this.deleteFromS3(post.imageKey);

    return this.prisma.communityPost.delete({ where: { id: postId } });
  }

  // ---- Download ----

  async downloadFile(postId: string) {
    const post = await this.prisma.communityPost.findUnique({
      where: { id: postId },
    });
    if (!post) throw new NotFoundException('Post no encontrado');
    if (!post.fileKey)
      throw new NotFoundException('Este post no tiene archivo adjunto');

    await this.prisma.communityPost.update({
      where: { id: postId },
      data: { downloads: { increment: 1 } },
    });

    const url = await this.getSignedDownloadUrl(post.fileKey);
    return { url };
  }

  // ---- Upvotes ----

  async toggleUpvote(postId: string, userId: string) {
    const existing = await this.prisma.postUpvote.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    if (existing) {
      await this.prisma.postUpvote.delete({
        where: { postId_userId: { postId, userId } },
      });
      return { upvoted: false };
    } else {
      await this.prisma.postUpvote.create({ data: { postId, userId } });
      return { upvoted: true };
    }
  }

  // ---- Comments ----

  async addComment(postId: string, authorId: string, content: string) {
    const post = await this.prisma.communityPost.findUnique({
      where: { id: postId },
    });
    if (!post) throw new NotFoundException('Post no encontrado');

    return this.prisma.postComment.create({
      data: { postId, authorId, content },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  async deleteComment(commentId: string, userId: string, userRole?: string) {
    const comment = await this.prisma.postComment.findUnique({
      where: { id: commentId },
    });
    if (!comment) throw new NotFoundException('Comentario no encontrado');
    const isSuperAdmin = userRole === 'SUPERADMIN';
    if (comment.authorId !== userId && !isSuperAdmin)
      throw new ForbiddenException('No puedes eliminar este comentario');
    return this.prisma.postComment.delete({ where: { id: commentId } });
  }

  // ---- Admin: list all posts ----
  async getAllPostsAdmin() {
    const posts = await this.prisma.communityPost.findMany({
      include: {
        author: { select: { id: true, name: true, email: true } },
        _count: { select: { comments: true, upvotes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return posts.map((p) => ({
      ...p,
      upvoteCount: p._count.upvotes,
      commentCount: p._count.comments,
    }));
  }
}
