import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaService } from '../prisma.service';
import { LINK_URL, LINK_URL_MESSAGE } from './content.controller';

/** Icon names the website knows how to draw (MarketFocusSlider). */
export const SLIDE_ICONS = ['sparkles', 'layers', 'box', 'users2', 'code2', 'users', 'briefcase', 'globe', 'cloud', 'shield'];

class SlideDto {
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsBoolean() is_featured?: boolean;
  @IsIn(SLIDE_ICONS) icon: string;
  @IsString() @MaxLength(40) tab_label_en: string;
  @IsOptional() @IsString() @MaxLength(40) tab_label_de?: string | null;
  @IsString() @MaxLength(60) badge_en: string;
  @IsOptional() @IsString() @MaxLength(60) badge_de?: string | null;
  @IsString() @MaxLength(200) title_en: string;
  @IsOptional() @IsString() @MaxLength(200) title_de?: string | null;
  @IsString() @MaxLength(500) subtitle_en: string;
  @IsOptional() @IsString() @MaxLength(500) subtitle_de?: string | null;
  @IsOptional() @IsString() @MaxLength(200) audience_en?: string | null;
  @IsOptional() @IsString() @MaxLength(200) audience_de?: string | null;
  @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(60, { each: true }) tags_en: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(60, { each: true }) tags_de?: string[];
  @IsOptional() @IsString() @MaxLength(60) button_text_en?: string | null;
  @IsOptional() @IsString() @MaxLength(60) button_text_de?: string | null;
  @IsOptional() @Matches(LINK_URL, { message: LINK_URL_MESSAGE }) @MaxLength(500) button_link?: string | null;
  @IsOptional() @IsString() @MaxLength(500) image_url?: string | null;
}

class UpdateSlideDto extends PartialType(SlideDto) {}

class OrderDto {
  @IsArray() @IsUUID('all', { each: true }) ids: string[];
}

/** Home page "Market Focus" slider. */
@Controller('admin/slides')
@UseGuards(AdminGuard)
export class SlidesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.homeSlide.findMany({ orderBy: { sort_order: 'asc' } });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.homeSlide.findUniqueOrThrow({ where: { id } });
  }

  @Post()
  async create(@Body() dto: SlideDto) {
    // New slides go to the end.
    const last = await this.prisma.homeSlide.aggregate({ _max: { sort_order: true } });
    return this.prisma.homeSlide.create({ data: { ...dto, sort_order: (last._max.sort_order ?? -1) + 1 } });
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSlideDto) {
    return this.prisma.homeSlide.update({ where: { id }, data: dto });
  }

  /** Saves the display order: `ids` must list every slide exactly once. */
  @Put('order')
  async reorder(@Body() dto: OrderDto) {
    const existing = await this.prisma.homeSlide.findMany({ select: { id: true } });
    const same = existing.length === dto.ids.length && new Set(dto.ids).size === dto.ids.length && existing.every((s) => dto.ids.includes(s.id));
    if (!same) throw new BadRequestException('The slide list changed. Reload the page and try again.');
    await this.prisma.$transaction(dto.ids.map((id, i) => this.prisma.homeSlide.update({ where: { id }, data: { sort_order: i } })));
    return this.list();
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.homeSlide.delete({ where: { id } });
  }
}
