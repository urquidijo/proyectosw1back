import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CommunityService } from './community.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('community')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  // GET /community/posts?search=...&tag=...
  @Get('posts')
  getPosts(@Query('search') search?: string, @Query('tag') tag?: string) {
    return this.communityService.getPosts(search, tag);
  }

  // GET /community/posts/:id
  @UseGuards(JwtAuthGuard)
  @Get('posts/:id')
  getPost(@Param('id') id: string, @Request() req) {
    return this.communityService.getPostById(id, req.user?.id);
  }

  // POST /community/posts  (multipart: sqlFile, imageFile, title, description, tags)
  @UseGuards(JwtAuthGuard)
  @Post('posts')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'sqlFile', maxCount: 1 },
        { name: 'imageFile', maxCount: 1 },
      ],
      { storage: memoryStorage() },
    ),
  )
  async createPost(
    @Request() req,
    @UploadedFiles()
    files: {
      sqlFile?: Express.Multer.File[];
      imageFile?: Express.Multer.File[];
    },
    @Body() body: any,
  ) {
    const tags = Array.isArray(body.tags)
      ? body.tags
      : body.tags
        ? body.tags.split(',').map((t: string) => t.trim())
        : [];

    if (!body.title || !body.description) {
      throw new BadRequestException('Título y descripción son requeridos');
    }

    return this.communityService.createPost(
      req.user.id,
      {
        title: body.title,
        description: body.description,
        tags,
        projectId: body.projectId,
      },
      files?.sqlFile?.[0],
      files?.imageFile?.[0],
    );
  }

  // DELETE /community/posts/:id
  @UseGuards(JwtAuthGuard)
  @Delete('posts/:id')
  deletePost(@Param('id') id: string, @Request() req) {
    return this.communityService.deletePost(id, req.user.id, req.user.role);
  }

  // POST /community/posts/:id/download
  @UseGuards(JwtAuthGuard)
  @Post('posts/:id/download')
  download(@Param('id') id: string) {
    return this.communityService.downloadFile(id);
  }

  // POST /community/posts/:id/upvote
  @UseGuards(JwtAuthGuard)
  @Post('posts/:id/upvote')
  toggleUpvote(@Param('id') id: string, @Request() req) {
    return this.communityService.toggleUpvote(id, req.user.id);
  }

  // POST /community/posts/:id/comments
  @UseGuards(JwtAuthGuard)
  @Post('posts/:id/comments')
  addComment(
    @Param('id') postId: string,
    @Request() req,
    @Body() body: { content: string },
  ) {
    return this.communityService.addComment(postId, req.user.id, body.content);
  }

  // DELETE /community/comments/:id
  @UseGuards(JwtAuthGuard)
  @Delete('comments/:id')
  deleteComment(@Param('id') id: string, @Request() req) {
    return this.communityService.deleteComment(id, req.user.id, req.user.role);
  }

  // GET /community/admin/posts  (SUPERADMIN only)
  @UseGuards(JwtAuthGuard)
  @Get('admin/posts')
  getAdminPosts(@Request() req) {
    if (req.user.role !== 'SUPERADMIN') {
      throw new Error('Acceso denegado');
    }
    return this.communityService.getAllPostsAdmin();
  }
}
