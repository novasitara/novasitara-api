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

The VPS runs only the backend: the API (systemd service), PostgreSQL and the storage folders, behind Nginx. The website and admin panel are hosted on Vercel.

```
Vercel (website, admin)  ──HTTPS──►  Nginx :80/:443  ──►  API 127.0.0.1:3000  ──►  PostgreSQL (localhost only)
                                                             └──►  /var/lib/novasitara/storage (images, CVs)
```

Only SSH, 80 and 443 are open. PostgreSQL and the API are not reachable from the internet.

**1. Key login (once).** Create a key and install it on the server; you type the server password yourself, once:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/novasitara_vps -N ""
ssh-copy-id -p 7576 -i ~/.ssh/novasitara_vps.pub root@SERVER_IP
```

On Windows without `ssh-copy-id`: `type %USERPROFILE%\.ssh\novasitara_vps.pub | ssh -p 7576 root@SERVER_IP "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"`.

**2. Set up the server (once).** Installs Node 22, PostgreSQL, Nginx, firewall, fail2ban, the systemd service and daily backups, and creates the database and `/var/www/novasitara-api/.env` with generated passwords (they stay on the server):

```bash
scp -P 7576 -i ~/.ssh/novasitara_vps deploy/setup-server.sh root@SERVER_IP:/tmp/
ssh -p 7576 -i ~/.ssh/novasitara_vps root@SERVER_IP bash /tmp/setup-server.sh
```

**3. Deploy (every release).** Uploads the last commit, installs, builds, runs migrations and restarts:

```bash
SERVER=root@SERVER_IP SSH_PORT=7576 SSH_KEY=~/.ssh/novasitara_vps bash deploy/deploy.sh
```

**4. Create the admin** (on the server, so the password never goes through chat or history):

```bash
ssh -p 7576 -i ~/.ssh/novasitara_vps root@SERVER_IP
cd /var/www/novasitara-api
read -rsp "Admin password: " ADMIN_PASSWORD; export ADMIN_PASSWORD
sudo -E -H -u novasitara npm run create-admin -- you@novasitara.com
```

**5. Email.** Edit `/var/www/novasitara-api/.env` (SMTP_* and `MAIL_TO`, the company inbox), then `systemctl restart novasitara-api`.

Useful: `systemctl status novasitara-api`, `journalctl -u novasitara-api -f`, `nginx -t`.

### Domain and SSL

Point a DNS A record (for example `api.novasitara.com`) at the server IP. Then on the server:

```bash
sed -i 's/server_name _;.*/server_name api.novasitara.com;/' /etc/nginx/sites-available/novasitara-api
nginx -t && systemctl reload nginx
certbot --nginx -d api.novasitara.com     # free SSL certificate, renews automatically
```

Until the domain has SSL the admin cannot sign in: its session cookie is `Secure` and browsers drop it over plain HTTP. Public endpoints work over HTTP for testing with `curl http://SERVER_IP/api/jobs`.

### Frontends on Vercel

Both apps call `/api/...` and show images from `/uploads/...` on their own address. Add this to each frontend's `vercel.json` (replace the domain) so Vercel forwards those paths to the API; the browser then only talks to Vercel, so there is no CORS setup and the login cookie is first-party:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://api.novasitara.com/api/:path*" },
    { "source": "/uploads/:path*", "destination": "https://api.novasitara.com/uploads/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

No Vercel environment variables are needed. Set `ADMIN_URL` in the server's `.env` to the admin panel's address so notification emails link to it.

## Backups

`setup-server.sh` installs a daily job (02:30) that writes `db-YYYY-MM-DD.dump` and `files-YYYY-MM-DD.tar.gz` to `/var/backups/novasitara` and keeps 14 days. A backup on the same server is lost with the server, so also turn on Hostinger's VPS snapshots and copy that folder off the server regularly (for example `rclone` to Google Drive).

Run one now: `/usr/local/bin/novasitara-backup`.

**Restore:**

```bash
systemctl stop novasitara-api
runuser -u postgres -- pg_restore --clean --if-exists -d novasitara /var/backups/novasitara/db-YYYY-MM-DD.dump
tar -xzf /var/backups/novasitara/files-YYYY-MM-DD.tar.gz -C /var/lib/novasitara
chown -R novasitara:novasitara /var/lib/novasitara
systemctl start novasitara-api
```
