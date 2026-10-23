import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'ns_admin';

export const sessionCookie: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict', // also blocks cross-site (CSRF) requests from carrying the session
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // matches the JWT expiry in AppModule
};

export interface AdminSession {
  sub: string;
  email: string;
}

/** Allows the request only with a valid admin session cookie. */
// ponytail: a deleted admin's session stays valid until it expires (max 7 days); check the admins table here if that matters.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    try {
      req.admin = await this.jwt.verifyAsync<AdminSession>(req.cookies?.[SESSION_COOKIE] ?? '');
      return true;
    } catch {
      throw new UnauthorizedException('Please sign in again.');
    }
  }
}
