import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const STORAGE_DIR = resolve(process.env.STORAGE_DIR ?? './storage');
/** Served at /uploads. */
export const PUBLIC_DIR = join(STORAGE_DIR, 'public');
/** Never served directly; admins download CVs through the API. */
export const RESUME_DIR = join(STORAGE_DIR, 'resumes');
mkdirSync(PUBLIC_DIR, { recursive: true });
mkdirSync(RESUME_DIR, { recursive: true });

/** Multer options: files stay in memory until validated, then are written to disk. */
export const uploadLimits = { limits: { fileSize: 5 * 1024 * 1024, files: 1 } };

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

/** Saves an admin image upload and returns its public URL path. */
export async function saveImage(file?: Express.Multer.File): Promise<string> {
  const ext = file && IMAGE_TYPES[file.mimetype];
  if (!file || !ext) throw new BadRequestException('Upload a JPG, PNG, WebP or SVG image (max 5 MB).');
  const name = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  await writeFile(join(PUBLIC_DIR, name), file.buffer);
  return `/uploads/${name}`;
}

/** Saves a CV after checking it really is a PDF; returns the stored file name. */
export async function saveResume(file?: Express.Multer.File): Promise<string> {
  if (!file || file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new BadRequestException('Please upload your CV as a PDF file (max 5 MB).');
  }
  const name = `${randomUUID()}.pdf`;
  await writeFile(join(RESUME_DIR, name), file.buffer);
  return name;
}
