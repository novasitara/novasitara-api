import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from 'class-validator';
import { join } from 'node:path';
import { MailService } from '../mail.service';
import { PrismaService } from '../prisma.service';
import { RESUME_DIR, saveResume, uploadLimits } from '../uploads';

// Visitor text is plain text: tags are removed so stored values and notification emails stay clean.
const stripTags = (value: unknown) => (typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : value);
const trim = () => Transform(({ value }) => stripTags(value));
const emptyToUndefined = () => Transform(({ value }) => stripTags(value) || undefined);
const phoneChars = () => Transform(({ value }) => (typeof value === 'string' ? value.replace(/[^0-9+\-\s()]/g, '').trim() : value));
// Public forms: at most 5 submissions per IP per 10 minutes.
const formLimit = () => Throttle({ default: { limit: 5, ttl: 10 * 60_000 } });

class EnquiryDto {
  @trim() @IsString() @MinLength(1) @MaxLength(100) name: string;
  @trim() @IsEmail() @MaxLength(200) email: string;
  @phoneChars() @IsString() @MaxLength(30) phone: string;
  @emptyToUndefined() @IsOptional() @IsString() @MaxLength(100) company?: string;
  @trim() @IsString() @MaxLength(100) service_requirement: string;
  @trim() @IsString() @MinLength(1) @MaxLength(5000) message: string;
}

class ApplicationDto {
  @Matches(/^[a-z0-9-]+$/) @MaxLength(100) job_id: string;
  @trim() @IsString() @MinLength(1) @MaxLength(100) full_name: string;
  @trim() @IsEmail() @MaxLength(200) email: string;
  @phoneChars() @IsString() @MinLength(1) @MaxLength(30) phone: string;
  @trim() @IsString() @MaxLength(100) current_location: string;
  @trim() @IsString() @MaxLength(30) years_of_experience: string;
  @trim() @IsString() @MaxLength(200) primary_skill: string;
  @emptyToUndefined() @IsOptional() @IsUrl({ protocols: ['http', 'https'] }) @MaxLength(300) linkedin_url?: string;
  @emptyToUndefined() @IsOptional() @IsString() @MaxLength(5000) cover_letter?: string;
}

const adminLink = (path: string) => (process.env.ADMIN_URL ? `${process.env.ADMIN_URL}${path}` : undefined);

@Controller()
export class PublicController {
  constructor(private readonly prisma: PrismaService, private readonly mail: MailService) {}

  /** Everything the website reads on load: text/image/contact overrides, menu links, home slides and published posts. */
  @Get('content')
  async content() {
    const [content, links, slides, posts] = await Promise.all([
      this.prisma.siteContent.findMany({ select: { key: true, value: true } }),
      this.prisma.siteLink.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' } }),
      this.prisma.homeSlide.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' } }),
      this.prisma.blogPost.findMany({ where: { is_published: true }, orderBy: { published_at: 'desc' } }),
    ]);
    return { overrides: Object.fromEntries(content.map((r) => [r.key, r.value])), links, slides, posts };
  }

  @Get('jobs')
  jobs() {
    return this.prisma.job.findMany({ where: { is_active: true }, orderBy: { created_at: 'desc' } });
  }

  @Get('jobs/:id')
  async job(@Param('id') id: string) {
    const job = await this.prisma.job.findFirst({ where: { id, is_active: true } });
    if (!job) throw new NotFoundException('Job not found.');
    return job;
  }

  @Post('enquiries')
  @HttpCode(201)
  @formLimit()
  async enquiry(@Body() dto: EnquiryDto) {
    const row = await this.prisma.enquiry.create({ data: { ...dto, email: dto.email.toLowerCase() } });
    void this.mail.notify(
      `New enquiry from ${row.name}${row.company ? ` (${row.company})` : ''}`,
      { Name: row.name, Email: row.email, Phone: row.phone, Company: row.company, Service: row.service_requirement, Message: row.message, Admin: adminLink('/enquiries') },
      row.email,
    );
    return { ok: true };
  }

  @Post('applications')
  @HttpCode(201)
  @formLimit()
  @UseInterceptors(FileInterceptor('resume', uploadLimits))
  async apply(@Body() dto: ApplicationDto, @UploadedFile() file?: Express.Multer.File) {
    const job = await this.prisma.job.findFirst({ where: { id: dto.job_id, is_active: true } });
    if (!job) throw new BadRequestException('This position is no longer open.');
    const stored = await saveResume(file);
    const row = await this.prisma.application.create({
      data: {
        ...dto,
        email: dto.email.toLowerCase(),
        resume_file_url: stored,
        resume_file_name: file!.originalname.replace(/[^\w.-]/g, '_').slice(-100),
      },
    });
    void this.mail.notify(
      `New application: ${job.title} – ${row.full_name}`,
      {
        Position: job.title, Name: row.full_name, Email: row.email, Phone: row.phone, Location: row.current_location,
        Experience: row.years_of_experience, 'Primary skill': row.primary_skill, LinkedIn: row.linkedin_url,
        'Cover letter': row.cover_letter, Admin: adminLink('/applications'),
      },
      row.email,
      [{ filename: row.resume_file_name ?? 'cv.pdf', path: join(RESUME_DIR, stored) }],
    );
    return { ok: true };
  }
}
