import './env';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { PrismaErrorFilter } from './prisma-errors.filter';
import { PUBLIC_DIR } from './uploads';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1); // behind Nginx: rate limits use the real client IP
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new PrismaErrorFilter(app.getHttpAdapter()));
  // Admin-uploaded images. No scripts may run from here (SVG uploads are allowed).
  app.useStaticAssets(PUBLIC_DIR, {
    prefix: '/uploads',
    maxAge: '30d',
    setHeaders: (res) => res.setHeader('Content-Security-Policy', "script-src 'none'"),
  });
  app.enableShutdownHooks();
  // HOST=127.0.0.1 on the server: only Nginx on the same machine may reach the API.
  await app.listen(process.env.PORT ?? 3000, process.env.HOST ?? '0.0.0.0');
}
bootstrap();
