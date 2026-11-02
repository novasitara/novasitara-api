import { Controller, Get, Post, Param, Res, NotFoundException, BadRequestException, UseGuards, Logger } from '@nestjs/common';
import type { Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { AdminGuard } from '../auth/admin.guard';

const execAsync = promisify(exec);

export const BACKUP_DIR = process.env.BACKUP_DIR || (fs.existsSync('/var/backups/novasitara') ? '/var/backups/novasitara' : path.join(process.cwd(), 'backups'));

export interface BackupItem {
  date: string;
  dbFile: string | null;
  dbSize: number;
  filesArchive: string | null;
  filesSize: number;
  totalSize: number;
  timestamp: string;
}

@Controller('admin/backups')
@UseGuards(AdminGuard)
export class BackupsController {
  private readonly log = new Logger(BackupsController.name);

  @Get()
  async listBackups() {
    if (!fs.existsSync(BACKUP_DIR)) {
      try {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      } catch {
        return {
          configured: false,
          schedule: 'Daily at 02:30 AM (14-day rolling retention)',
          location: BACKUP_DIR,
          backups: [],
        };
      }
    }

    const files = await fs.promises.readdir(BACKUP_DIR);
    const groups = new Map<string, { dbFile: string | null; dbSize: number; filesArchive: string | null; filesSize: number; timestamp: string }>();

    for (const f of files) {
      const fullPath = path.join(BACKUP_DIR, f);
      try {
        const stat = await fs.promises.stat(fullPath);
        if (!stat.isFile()) continue;

        const dbMatch = f.match(/^db-(.+)\.dump$/);
        const filesMatch = f.match(/^files-(.+)\.tar\.gz$/);

        if (dbMatch) {
          const date = dbMatch[1];
          const curr = groups.get(date) || { dbFile: null, dbSize: 0, filesArchive: null, filesSize: 0, timestamp: stat.mtime.toISOString() };
          curr.dbFile = f;
          curr.dbSize = stat.size;
          curr.timestamp = stat.mtime.toISOString();
          groups.set(date, curr);
        } else if (filesMatch) {
          const date = filesMatch[1];
          const curr = groups.get(date) || { dbFile: null, dbSize: 0, filesArchive: null, filesSize: 0, timestamp: stat.mtime.toISOString() };
          curr.filesArchive = f;
          curr.filesSize = stat.size;
          groups.set(date, curr);
        }
      } catch (err) {
        this.log.warn(`Could not read backup file ${f}: ${err}`);
      }
    }

    const backups: BackupItem[] = Array.from(groups.entries())
      .map(([date, data]) => ({
        date,
        dbFile: data.dbFile,
        dbSize: data.dbSize,
        filesArchive: data.filesArchive,
        filesSize: data.filesSize,
        totalSize: data.dbSize + data.filesSize,
        timestamp: data.timestamp,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return {
      configured: true,
      schedule: 'Daily at 02:30 AM (14-day rolling retention)',
      location: BACKUP_DIR,
      backups,
    };
  }

  @Post('run')
  async triggerBackup() {
    this.log.log('Admin requested manual backup creation');
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dbDump = path.join(BACKUP_DIR, `db-${stamp}.dump`);
    const filesTar = path.join(BACKUP_DIR, `files-${stamp}.tar.gz`);

    try {
      const dbUrl = process.env.DATABASE_URL;
      if (dbUrl) {
        await execAsync(`pg_dump "${dbUrl}" -Fc > "${dbDump}"`);
      }

      const storageDir = process.env.STORAGE_DIR || (fs.existsSync('/var/lib/novasitara/storage') ? '/var/lib/novasitara/storage' : path.join(process.cwd(), 'storage'));
      if (fs.existsSync(storageDir)) {
        const parentDir = path.dirname(storageDir);
        const folderName = path.basename(storageDir);
        await execAsync(`tar -czf "${filesTar}" -C "${parentDir}" "${folderName}"`);
      }

      return {
        success: true,
        message: `Backup created successfully (${stamp})`,
        dbFile: `db-${stamp}.dump`,
        filesArchive: `files-${stamp}.tar.gz`,
      };
    } catch (err: any) {
      this.log.error('Manual backup creation failed', err.stack);
      throw new BadRequestException(`Backup creation failed: ${err.message}`);
    }
  }

  @Get('download/:filename')
  async downloadBackup(@Param('filename') filename: string, @Res() res: Response) {
    if (!/^(db|files)-[\w\-.]+\.(dump|tar\.gz)$/.test(filename)) {
      throw new BadRequestException('Invalid backup filename');
    }
    const fullPath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException('Backup file not found on server');
    }
    return res.download(fullPath, filename);
  }
}
