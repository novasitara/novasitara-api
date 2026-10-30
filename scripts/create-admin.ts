// Creates an admin, or resets an existing admin's password.
// Usage: npm run create-admin -- admin@novasitara.com "a-long-password"
// Or keep the password out of shell history: ADMIN_PASSWORD=... npm run create-admin -- admin@novasitara.com
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/auth/password';
import { PrismaClient } from '../src/generated/prisma/client';

try { process.loadEnvFile(); } catch { /* use the real environment */ }

async function main() {
  const [email, argPassword] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD ?? argPassword;
  if (!email?.includes('@') || !password || password.length < 10) {
    console.error('Usage: npm run create-admin -- <email> <password (min 10 characters)>  (or set ADMIN_PASSWORD)');
    process.exit(1);
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const password_hash = await hashPassword(password);
  const normalized = email.toLowerCase().trim();
  await prisma.admin.upsert({ where: { email: normalized }, create: { email: normalized, password_hash }, update: { password_hash } });
  await prisma.$disconnect();
  console.log(`Admin ready: ${normalized}`);
}

main();
