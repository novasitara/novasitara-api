import '../src/env';
import { isEmail } from 'class-validator';
import { PrismaService } from '../src/prisma.service';

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  const name = process.argv.slice(3).join(' ').trim();
  if (email.length > 200 || !isEmail(email) || name.length < 1 || name.length > 120) {
    console.error('Usage: npm run create-portal-owner -- <confirmed-owner-email> <name>');
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('Database connection is not configured.');
  const prisma = new PrismaService();
  try {
    const member = await prisma.portalMember.upsert({
      where: { email }, create: { email, name, role: 'owner' }, update: {},
      select: { role: true, active: true },
    });
    if (member.role !== 'owner' || !member.active) {
      console.error('An incompatible account already uses that email; no permissions were changed.');
      process.exitCode = 1;
      return;
    }
    console.log('Portal owner access is enabled. Request a sign-in link from the company website.');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error('Could not provision the owner. Check database configuration and portal migration.');
  process.exitCode = 1;
});
