import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApplicationsController } from './admin/applications.controller';
import { BlogsController } from './admin/blogs.controller';
import { ContentController } from './admin/content.controller';
import { DashboardController } from './admin/dashboard.controller';
import { EnquiriesController } from './admin/enquiries.controller';
import { JobsController } from './admin/jobs.controller';
import { SlidesController } from './admin/slides.controller';
import { AuthController } from './auth/auth.controller';
import { MailService } from './mail.service';
import { PrismaService } from './prisma.service';
import { PublicController } from './public/public.controller';

@Module({
  imports: [
    JwtModule.register({ global: true, secret: process.env.JWT_SECRET, signOptions: { expiresIn: '7d' } }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  controllers: [
    PublicController,
    AuthController,
    DashboardController,
    JobsController,
    ApplicationsController,
    EnquiriesController,
    BlogsController,
    ContentController,
    SlidesController,
  ],
  providers: [PrismaService, MailService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
