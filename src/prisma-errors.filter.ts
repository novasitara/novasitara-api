import { ArgumentsHost, Catch, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from './generated/prisma/client';

const MAPPED: Record<string, () => HttpException> = {
  P2002: () => new ConflictException('An item with this ID or slug already exists. Use a different one.'),
  P2003: () => new ConflictException('This job has applications, so it cannot be deleted. Deactivate it instead.'),
  P2025: () => new NotFoundException('Not found.'),
};

/** Turns common database errors into clear 4xx responses instead of 500s. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaErrorFilter extends BaseExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    super.catch(MAPPED[error.code]?.() ?? error, host);
  }
}
