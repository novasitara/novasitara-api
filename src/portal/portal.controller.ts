import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Logger, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post, Req, Res, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import type { CookieOptions, Request, Response } from 'express';
import { MailService } from '../mail.service';
import { PrismaService } from '../prisma.service';

const sessionCookie = 'ns_portal';
const sessionMs = 8 * 60 * 60_000;
const linkMs = 15 * 60_000;
const cooldownMs = 60_000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const options: CookieOptions = {
  httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/api/portal',
};
const memberSelect = { id: true, email: true, name: true, role: true, active: true } as const;
const identity = <T extends { email: string; name: string; role: 'owner' | 'employee' }>(
  { email, name, role }: T,
) => ({ email, name, role });

export function portalOrigin() {
  return process.env.NODE_ENV === 'production' ? 'https://www.novasitara.com' : 'http://localhost:5173';
}

export function requirePortalOrigin(origin: string | undefined) {
  if (origin !== portalOrigin()) throw new ForbiddenException('Open the portal from the Nova Sitara website.');
}

export function hashPortalToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

class RequestLinkDto {
  @IsEmail() @MaxLength(200) email: string;
}
class RedeemDto {
  @IsString() @Matches(tokenPattern) token: string;
}
class MemberDto extends RequestLinkDto {
  @IsString() @MaxLength(120) name: string;
}
class ActiveDto {
  @IsBoolean() active: boolean;
}

@Controller('portal')
export class PortalController {
  private readonly log = new Logger(PortalController.name);

  constructor(private readonly prisma: PrismaService, private readonly mail: MailService) {}

  @Post('request-link')
  @HttpCode(200)
  @Throttle({ default: { limit: 8, ttl: 15 * 60_000 } })
  async requestLink(@Req() req: Request, @Body() dto: RequestLinkDto) {
    requirePortalOrigin(req.get('origin'));
    if (!this.mail.canSendPortalMail()) {
      throw new ServiceUnavailableException('Sign-in email is not available. Contact Nova Sitara.');
    }
    const email = dto.email.trim().toLowerCase();
    const now = new Date();
    const token = randomBytes(32).toString('base64url');
    const hash = hashPortalToken(token);
    const result = await this.prisma.portalMember.updateMany({
      where: { email, active: true, OR: [
        { last_link_at: null },
        { last_link_at: { lte: new Date(now.getTime() - cooldownMs) } },
      ] },
      data: { last_link_at: now, link_hash: hash, link_expires_at: new Date(now.getTime() + linkMs) },
    });
    if (result.count === 1) {
      const url = `${portalOrigin()}/portal/activate#token=${token}`;
      // Same response for unknown, disabled, throttled and active addresses; don't expose SMTP latency.
      void this.mail.sendPortalLink(email, url).catch(async () => {
        this.log.warn('A portal sign-in email could not be delivered.');
        await this.prisma.portalMember.updateMany({
          where: { email, link_hash: hash },
          data: { link_hash: null, link_expires_at: null },
        }).catch(() => this.log.warn('Could not invalidate an undelivered portal link.'));
      });
    }
    return { message: 'If this email has portal access, you will receive a sign-in link.' };
  }

  @Post('redeem')
  @HttpCode(200)
  @Throttle({ default: { limit: 15, ttl: 15 * 60_000 } })
  async redeem(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() dto: RedeemDto) {
    requirePortalOrigin(req.get('origin'));
    const now = new Date();
    const hash = hashPortalToken(dto.token);
    const token = randomBytes(32).toString('base64url');
    const previous = this.cookieToken(req);
    const member = await this.prisma.$transaction(async (tx) => {
      const user = await tx.portalMember.findUnique({ where: { link_hash: hash }, select: memberSelect });
      if (!user?.active) throw new UnauthorizedException('This sign-in link is no longer valid. Request a new one.');
      const spent = await tx.portalMember.updateMany({
        where: { id: user.id, active: true, link_hash: hash, link_expires_at: { gt: now } },
        data: { link_hash: null, link_expires_at: null },
      });
      if (spent.count !== 1) throw new UnauthorizedException('This sign-in link is no longer valid. Request a new one.');
      if (previous) await tx.portalSession.deleteMany({ where: { token_hash: hashPortalToken(previous) } });
      await tx.portalSession.deleteMany({ where: { member_id: user.id, expires_at: { lte: now } } });
      await tx.portalSession.create({
        data: { token_hash: hashPortalToken(token), member_id: user.id, expires_at: new Date(now.getTime() + sessionMs) },
      });
      return user;
    });
    res.cookie(sessionCookie, token, { ...options, maxAge: sessionMs });
    return identity(member);
  }

  @Get('me')
  async me(@Req() req: Request) {
    return identity(await this.requireMember(req));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    requirePortalOrigin(req.get('origin'));
    const token = this.cookieToken(req);
    if (token) await this.prisma.portalSession.deleteMany({ where: { token_hash: hashPortalToken(token) } });
    res.clearCookie(sessionCookie, options);
  }

  @Get('members')
  async members(@Req() req: Request) {
    await this.requireOwner(req);
    return this.prisma.portalMember.findMany({ select: memberSelect, orderBy: [{ name: 'asc' }, { email: 'asc' }] });
  }

  @Post('members')
  async addMember(@Req() req: Request, @Body() dto: MemberDto) {
    requirePortalOrigin(req.get('origin'));
    await this.requireOwner(req);
    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Enter the employee’s name.');
    return this.prisma.portalMember.upsert({
      where: { email }, create: { email, name, role: 'employee' }, update: {}, select: memberSelect,
    });
  }

  @Patch('members/:id')
  async setMemberActive(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ActiveDto) {
    requirePortalOrigin(req.get('origin'));
    await this.requireOwner(req);
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.portalMember.updateMany({
        where: { id, role: 'employee' },
        data: { active: dto.active, ...(dto.active ? {} : { link_hash: null, link_expires_at: null, last_link_at: null }) },
      });
      if (!result.count) throw new NotFoundException('Employee account not found.');
      if (!dto.active) await tx.portalSession.deleteMany({ where: { member_id: id } });
      return tx.portalMember.findUniqueOrThrow({ where: { id }, select: memberSelect });
    });
  }

  private cookieToken(req: Request): string | undefined {
    const token: unknown = req.cookies?.[sessionCookie];
    return typeof token === 'string' && tokenPattern.test(token) ? token : undefined;
  }

  private async requireMember(req: Request) {
    const token = this.cookieToken(req);
    if (!token) throw new UnauthorizedException('Please sign in.');
    const session = await this.prisma.portalSession.findUnique({
      where: { token_hash: hashPortalToken(token) }, include: { member: { select: memberSelect } },
    });
    if (!session?.member.active || session.expires_at.getTime() <= Date.now()) {
      throw new UnauthorizedException('Please sign in again.');
    }
    return session.member;
  }

  private async requireOwner(req: Request) {
    if ((await this.requireMember(req)).role !== 'owner') throw new ForbiddenException('Owner access is required.');
  }
}
