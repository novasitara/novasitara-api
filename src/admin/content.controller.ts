import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { saveImage, uploadLimits } from '../uploads';

// Allowed site_content keys: `text.<path>`, `image.<name>` and `company`.
const CONTENT_KEY = /^(text\.[A-Za-z0-9_.]+|image\.[a-z0-9-]+|company)$/;
const LINK_GROUPS = ['navbar', 'footer'];
/** A page on this site (/careers), an external address, mailto: or tel:. */
export const LINK_URL = /^(\/\S*|https?:\/\/\S+|mailto:\S+|tel:\S+)$/i;
export const LINK_URL_MESSAGE = 'Links must start with /, https://, mailto: or tel:';

class ContentChangesDto {
  @IsOptional() @IsObject() upsert?: Record<string, Prisma.InputJsonValue>;
  @IsOptional() @IsArray() @IsString({ each: true }) remove?: string[];
}

class LinkDto {
  @IsString() @MaxLength(100) label_en: string;
  @IsOptional() @IsString() @MaxLength(100) label_de?: string | null;
  @Matches(LINK_URL, { message: LINK_URL_MESSAGE }) @MaxLength(500) url: string;
  @IsBoolean() is_active: boolean;
}

class LinksDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => LinkDto) links: LinkDto[];
}

/** Website text (EN/DE), images, contact details and menu links. */
@Controller('admin')
@UseGuards(AdminGuard)
export class ContentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('content')
  async content() {
    const rows = await this.prisma.siteContent.findMany({ select: { key: true, value: true } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  @Patch('content')
  async changeContent(@Body() dto: ContentChangesDto) {
    const upserts = Object.entries(dto.upsert ?? {});
    const removes = dto.remove ?? [];
    const bad = [...upserts.map(([k]) => k), ...removes].find((k) => !CONTENT_KEY.test(k));
    if (bad) throw new BadRequestException(`Unknown content key: ${bad}`);
    await this.prisma.$transaction([
      ...upserts.map(([key, value]) => this.prisma.siteContent.upsert({ where: { key }, create: { key, value }, update: { value } })),
      this.prisma.siteContent.deleteMany({ where: { key: { in: removes } } }),
    ]);
    return { ok: true };
  }

  @Get('links')
  links(@Query('group') group: string) {
    return this.prisma.siteLink.findMany({ where: { group_name: group }, orderBy: { sort_order: 'asc' } });
  }

  /** Replaces all links of a group, in the given order. An empty list restores the website's built-in links. */
  @Put('links/:group')
  async replaceLinks(@Param('group') group: string, @Body() dto: LinksDto) {
    if (!LINK_GROUPS.includes(group)) throw new BadRequestException('Unknown link group.');
    await this.prisma.$transaction([
      this.prisma.siteLink.deleteMany({ where: { group_name: group } }),
      this.prisma.siteLink.createMany({
        data: dto.links.map((l, i) => ({ ...l, url: l.url.trim(), label_de: l.label_de || null, group_name: group, sort_order: i })),
      }),
    ]);
    return this.links(group);
  }

  @Post('uploads')
  @UseInterceptors(FileInterceptor('file', uploadLimits))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    return { url: await saveImage(file) };
  }
}
