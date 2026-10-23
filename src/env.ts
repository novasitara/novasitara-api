// Imported first in main.ts so every module sees the variables.
try { process.loadEnvFile(); } catch { /* no .env file: use the real environment */ }

for (const key of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[key]) throw new Error(`Missing environment variable ${key} (see .env.example)`);
}
