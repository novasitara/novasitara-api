import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaService } from '../prisma.service';

@Controller('admin/stats')
@UseGuards(AdminGuard)
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async stats() {
    const [jobs, applications, newApplications, enquiries, newEnquiries] = await Promise.all([
      this.prisma.job.count({ where: { is_active: true } }),
      this.prisma.application.count(),
      this.prisma.application.count({ where: { status: 'new' } }),
      this.prisma.enquiry.count(),
      this.prisma.enquiry.count({ where: { status: 'new' } }),
    ]);
    return { jobs, applications, newApplications, enquiries, newEnquiries };
  }
}
