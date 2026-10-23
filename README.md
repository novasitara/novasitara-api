# Nova Sitara API

Backend for the Nova Sitara website (`novasitara`) and admin panel (`novasitara-admin`).
NestJS + PostgreSQL (Prisma). Uploaded images and CVs are stored on the server's disk.

```
novasitara/         website   (Vite React)  → calls /api, shows /uploads images
novasitara-admin/   admin     (Vite React)  → calls /api with the admin session cookie
novasitara-api/     this API  (NestJS)      → PostgreSQL + storage/ folder + SMTP email
```

## Local setup

Needs Node 22.12+ and a PostgreSQL database (local, or a Neon test database).

```bash
cd novasitara-api
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npm install                   # also generates the Prisma client
npm run db:deploy             # creates the tables
npm run create-admin -- you@novasitara.com "a-long-password"
npm run start:dev             # http://localhost:3000/api
```

Then in two more terminals:

```bash
cd novasitara && npm install && npm run dev          # http://localhost:5173
cd novasitara-admin && npm install && npm run dev    # http://localhost:5174
```

Both frontends proxy `/api` and `/uploads` to port 3000 (see their `vite.config.ts`), so no frontend env vars are needed.

`npm test` runs the password-hashing check. `npm run create-admin` also resets an existing admin's password.

## Changing the database

Edit `prisma/schema.prisma`, then run `npm run db:migrate -- --name what-changed` locally. Commit the new folder in `prisma/migrations`; production applies it with `npm run db:deploy`.

## API overview

| Public | |
|---|---|
| `GET /api/content` | text/image/contact overrides, menu links, active home slides, published blog posts |
| `GET /api/jobs`, `GET /api/jobs/:id` | active jobs |
| `POST /api/enquiries` | contact form (JSON). Saved, then emailed to `MAIL_TO` |
| `POST /api/applications` | job application (multipart, `resume` = PDF ≤ 5 MB). Saved, then emailed with the CV attached |

Public forms are limited to 5 submissions per IP per 10 minutes.

| Admin (needs the `ns_admin` session cookie from `POST /api/auth/login`) | |
|---|---|
| `GET /api/auth/me`, `POST /api/auth/logout` | session |
| `GET /api/admin/stats` | dashboard counts |
| `/api/admin/jobs` | list, get, create, `PATCH`, delete (a job with applications can only be deactivated) |
| `/api/admin/applications` | list, `PATCH` status, delete, `GET :id/resume` downloads the CV |
| `/api/admin/enquiries` | list, `PATCH` status, delete |
| `/api/admin/blogs` | list, get, create, `PATCH`, delete |
| `/api/admin/slides` | home page slider: list, get, create, `PATCH`, delete, `PUT /order` with every slide id in the new order |
| `GET/PATCH /api/admin/content` | website text (EN/DE), image overrides, contact details |
| `GET /api/admin/links?group=`, `PUT /api/admin/links/:group` | navbar/footer links |
| `POST /api/admin/uploads` | image upload (`file`), returns `{ url }` |

## Importing the old Supabase data

Table and column names are the same as in Supabase, so the data can be copied directly.
Create the tables first (`npm run db:deploy`), then:

```bash
pg_dump "<supabase connection string>" --data-only --no-owner --no-privileges \
  -t public.jobs -t public.applications -t public.enquiries \
  -t public.site_content -t public.site_links -t public.blog_posts > supabase-data.sql
psql "$DATABASE_URL" -f supabase-data.sql
```

Files are not part of that dump:
- **CVs** (Supabase bucket `resumes`): download them and put all files directly in `storage/resumes/` (no subfolders). Old rows store paths like `job-id/123_name.pdf`, and the API looks up just the file name.
- **Images** (bucket `site-media`): image URLs in `site_content` and `blog_posts` still point to Supabase. Re-upload them in the admin panel before the Supabase project is deleted.
- **Admins**: Supabase Auth users don't carry over. Create them with `npm run create-admin`.

## Deploying to the Hostinger VPS (Ubuntu)

One-time server setup:

```bash
sudo apt update && sudo apt install -y nginx postgresql certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm install -g pm2

sudo -u postgres psql -c "CREATE USER novasitara WITH PASSWORD 'strong-password';"
sudo -u postgres psql -c "CREATE DATABASE novasitara OWNER novasitara;"
```

API (`/var/www/novasitara-api`, `.env` with `NODE_ENV=production`, `DATABASE_URL=postgresql://novasitara:...@localhost:5432/novasitara`, `STORAGE_DIR=/var/www/novasitara-storage`, SMTP settings):

```bash
npm ci && npm run build && npm run db:deploy
pm2 start dist/main.js --name novasitara-api && pm2 save && pm2 startup
```

Frontends: run `npm ci && npm run build` in each, then copy `dist/` to `/var/www/novasitara` and `/var/www/novasitara-admin`.

Nginx (`/etc/nginx/sites-available/novasitara`, then `ln -s` it into `sites-enabled`):

```nginx
server {
  server_name novasitara.com www.novasitara.com;
  root /var/www/novasitara;
  client_max_body_size 6m;
  location /api/    { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
  location /uploads/ { alias /var/www/novasitara-storage/public/; expires 30d; add_header Content-Security-Policy "script-src 'none'"; }
  location / { try_files $uri /index.html; }
}

server {
  server_name admin.novasitara.com;
  root /var/www/novasitara-admin;
  client_max_body_size 6m;
  location /api/    { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
  location /uploads/ { alias /var/www/novasitara-storage/public/; expires 30d; add_header Content-Security-Policy "script-src 'none'"; }
  location / { try_files $uri /index.html; }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d novasitara.com -d www.novasitara.com -d admin.novasitara.com   # free SSL, auto-renews
```

Point the DNS A records for `novasitara.com`, `www` and `admin` at the VPS IP before running certbot.

Updating later: `git pull && npm ci && npm run build && npm run db:deploy && pm2 restart novasitara-api`.

## Backups

Daily database dump and file archive, 14 days kept (`/etc/cron.d/novasitara-backup`):

```cron
30 2 * * * postgres pg_dump -Fc novasitara > /var/backups/novasitara/db-$(date +\%F).dump
45 2 * * * root tar -czf /var/backups/novasitara/files-$(date +\%F).tar.gz -C /var/www novasitara-storage
0 4 * * * root find /var/backups/novasitara -type f -mtime +14 -delete
```

(`sudo mkdir -p /var/backups/novasitara && sudo chown postgres /var/backups/novasitara`)

A backup on the same server is lost with the server. Also turn on Hostinger's VPS snapshots, and copy `/var/backups/novasitara` off the server (for example `rclone sync` to Google Drive) every day.

**Restore:**

```bash
pm2 stop novasitara-api
sudo -u postgres pg_restore --clean --if-exists -d novasitara /var/backups/novasitara/db-YYYY-MM-DD.dump
sudo tar -xzf /var/backups/novasitara/files-YYYY-MM-DD.tar.gz -C /var/www
pm2 start novasitara-api
```
