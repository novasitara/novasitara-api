import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { PrismaService } from '../prisma.service';
import { AdminGuard, AdminSession, SESSION_COOKIE, sessionCookie } from './admin.guard';
import { verifyPassword } from './password';

class LoginDto {
  @IsEmail() @MaxLength(200) email: string;
  @IsString() @MaxLength(200) password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const admin = await this.prisma.admin.findUnique({ where: { email: dto.email.toLowerCase().trim() } });
    if (!admin || !(await verifyPassword(dto.password, admin.password_hash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    const session: AdminSession = { sub: admin.id, email: admin.email };
    res.cookie(SESSION_COOKIE, await this.jwt.signAsync(session), sessionCookie);
    return { email: admin.email };
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    const { maxAge: _, ...options } = sessionCookie;
    res.clearCookie(SESSION_COOKIE, options);
  }

  @Get('me')
  @UseGuards(AdminGuard)
  me(@Req() req: { admin: AdminSession }) {
    return { email: req.admin.email };
  }
}
