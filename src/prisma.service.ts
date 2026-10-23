import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
      // The 2s default is too short when a new TLS connection to a remote database (e.g. Neon) must be opened first.
      transactionOptions: { maxWait: 10_000, timeout: 20_000 },
    });
  }

  onModuleDestroy() {
    return this.$disconnect();
  }
}
