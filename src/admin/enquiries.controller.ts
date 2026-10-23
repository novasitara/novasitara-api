import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaService } from '../prisma.service';

class StatusDto {
  @IsIn(['new', 'read', 'responded']) status: string;
}

@Controller('admin/enquiries')
@UseGuards(AdminGuard)
export class EnquiriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.enquiry.findMany({ orderBy: { created_at: 'desc' } });
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    return this.prisma.enquiry.update({ where: { id }, data: { status: dto.status } });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.enquiry.delete({ where: { id } });
  }
}
