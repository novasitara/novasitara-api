import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsDateString, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaService } from '../prisma.service';

class BlogDto {
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug may only contain lowercase letters, numbers and dashes.' }) @MaxLength(150) slug: string;
  @IsString() @MaxLength(300) title_en: string;
  @IsOptional() @IsString() @MaxLength(300) title_de?: string | null;
  @IsOptional() @IsString() @MaxLength(100) category_en?: string | null;
  @IsOptional() @IsString() @MaxLength(100) category_de?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) excerpt_en?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) excerpt_de?: string | null;
  @IsOptional() @IsString() @MaxLength(100000) content_en?: string | null;
  @IsOptional() @IsString() @MaxLength(100000) content_de?: string | null;
  @IsOptional() @IsString() @MaxLength(500) image_url?: string | null;
  @IsOptional() @IsString() @MaxLength(200) seo_title?: string | null;
  @IsOptional() @IsString() @MaxLength(500) seo_description?: string | null;
  @IsOptional() @IsBoolean() is_published?: boolean;
  @IsOptional() @IsDateString() published_at?: string | null;
}

class UpdateBlogDto extends PartialType(BlogDto) {}

@Controller('admin/blogs')
@UseGuards(AdminGuard)
export class BlogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.blogPost.findMany({
      select: { id: true, slug: true, title_en: true, is_published: true, published_at: true, created_at: true },
      orderBy: { created_at: 'desc' },
    });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.blogPost.findUniqueOrThrow({ where: { id } });
  }

  @Post()
  create(@Body() dto: BlogDto) {
    return this.prisma.blogPost.create({ data: dto });
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBlogDto) {
    return this.prisma.blogPost.update({ where: { id }, data: dto });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.blogPost.delete({ where: { id } });
  }
}
