import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Res, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import type { Response } from 'express';
import { rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaService } from '../prisma.service';
import { RESUME_DIR } from '../uploads';

class StatusDto {
  @IsIn(['new', 'reviewed', 'shortlisted', 'rejected']) status: string;
}

@Controller('admin/applications')
@UseGuards(AdminGuard)
export class ApplicationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.application.findMany({ include: { job: { select: { title: true } } }, orderBy: { created_at: 'desc' } });
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    return this.prisma.application.update({ where: { id }, data: { status: dto.status } });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const row = await this.prisma.application.delete({ where: { id } });
    if (row.resume_file_url) await rm(join(RESUME_DIR, basename(row.resume_file_url)), { force: true });
  }

  @Get(':id/resume')
  async resume(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const row = await this.prisma.application.findUniqueOrThrow({ where: { id } });
    if (!row.resume_file_url) throw new NotFoundException('This application has no CV.');
    // basename(): stored values are plain file names; never let a path escape RESUME_DIR.
    res.download(join(RESUME_DIR, basename(row.resume_file_url)), row.resume_file_name ?? 'cv.pdf', (err) => {
      if (err && !res.headersSent) res.status(404).json({ message: 'CV file not found on the server.' });
    });
  }
}
