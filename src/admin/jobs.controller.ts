import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsArray, IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaService } from '../prisma.service';

class JobDto {
  @Matches(/^[a-z0-9-]+$/, { message: 'Job ID may only contain lowercase letters, numbers and dashes.' }) @MaxLength(100) id: string;
  @IsString() @MaxLength(200) title: string;
  @IsString() @MaxLength(100) location: string;
  @IsString() @MaxLength(50) type: string;
  @IsString() @MaxLength(50) experience: string;
  @IsString() @MaxLength(200) department: string;
  @IsOptional() @IsString() @MaxLength(50) posted_date?: string;
  @IsString() @MaxLength(10000) overview: string;
  @IsArray() @IsString({ each: true }) responsibilities: string[];
  @IsArray() @IsString({ each: true }) requirements: string[];
  @IsArray() @IsString({ each: true }) preferred_skills: string[];
  @IsArray() @IsString({ each: true }) benefits: string[];
  @IsOptional() @IsString() @MaxLength(200) title_de?: string | null;
  @IsOptional() @IsString() @MaxLength(200) department_de?: string | null;
  @IsOptional() @IsString() @MaxLength(10000) overview_de?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) responsibilities_de?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) requirements_de?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) preferred_skills_de?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) benefits_de?: string[];
  @IsOptional() @IsBoolean() is_active?: boolean;
}

class UpdateJobDto extends PartialType(OmitType(JobDto, ['id'] as const)) {}

@Controller('admin/jobs')
@UseGuards(AdminGuard)
export class JobsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.job.findMany({ orderBy: { created_at: 'desc' } });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.prisma.job.findUniqueOrThrow({ where: { id } });
  }

  @Post()
  create(@Body() dto: JobDto) {
    return this.prisma.job.create({ data: dto });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateJobDto) {
    return this.prisma.job.update({ where: { id }, data: dto });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.prisma.job.delete({ where: { id } });
  }
}
