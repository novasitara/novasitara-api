#!/usr/bin/env bash
# One-time setup of an Ubuntu VPS for the Nova Sitara API: Node 22, PostgreSQL, Nginx, firewall,
# fail2ban, a systemd service and daily backups. Safe to run again: an existing database, .env and
# uploaded files are kept.
#
# Run on the server as root (see README):
#   scp -P 7576 deploy/setup-server.sh root@SERVER:/tmp/ && ssh -p 7576 root@SERVER bash /tmp/setup-server.sh
set -euo pipefail

SSH_PORT="${SSH_PORT:-7576}"   # the firewall keeps this port open for you
APP_USER=novasitara
APP_DIR=/var/www/novasitara-api
DATA_DIR=/var/lib/novasitara   # storage/public (images) and storage/resumes (CVs) live here, outside the code folder
BACKUP_DIR=/var/backups/novasitara
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y nginx postgresql curl openssl ufw fail2ban certbot python3-certbot-nginx

# Node 22 (the API needs >= 22.12)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Unprivileged user that runs the API, and its folders
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR/storage/public" "$DATA_DIR/storage/resumes"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"
install -d -m 700 "$BACKUP_DIR"

# Database and .env, created once. Passwords are generated here and never leave the server.
if [ ! -f "$APP_DIR/.env" ]; then
  DB_PASS=$(openssl rand -hex 24)
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'novasitara') THEN CREATE ROLE novasitara LOGIN; END IF;
END \$\$;
ALTER ROLE novasitara PASSWORD '$DB_PASS';
SQL
  runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='novasitara'" | grep -q 1 \
    || runuser -u postgres -- createdb -O novasitara novasitara
  (
    umask 077
    cat > "$APP_DIR/.env" <<EOF
DATABASE_URL=postgresql://novasitara:$DB_PASS@127.0.0.1:5432/novasitara
JWT_SECRET=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')
HOST=127.0.0.1
PORT=3000
STORAGE_DIR=$DATA_DIR/storage

# Fill these in to get enquiry/application emails, then: systemctl restart novasitara-api
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
MAIL_TO=
ADMIN_URL=
EOF
  )
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  echo "Created $APP_DIR/.env"
fi

# systemd service
cat > /etc/systemd/system/novasitara-api.service <<'EOF'
[Unit]
Description=Nova Sitara API
After=network.target postgresql.service

[Service]
User=novasitara
WorkingDirectory=/var/www/novasitara-api
EnvironmentFile=/var/www/novasitara-api/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable novasitara-api

# Nginx: the only thing exposed to the internet. Everything is passed to the API on 127.0.0.1:3000.
cat > /etc/nginx/sites-available/novasitara-api <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name _;          # replace with api.yourdomain.com once its DNS points here, then run certbot (see README)
    server_tokens off;
    client_max_body_size 6m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/novasitara-api /etc/nginx/sites-enabled/novasitara-api
rm -f /etc/nginx/sites-enabled/default   # the stock "Welcome to nginx" site
nginx -t
systemctl reload nginx

# Firewall: SSH, HTTP, HTTPS only. PostgreSQL (5432) and the API (3000) stay private.
ufw allow "$SSH_PORT/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# fail2ban: ban IPs that keep guessing SSH passwords on the custom port
cat > /etc/fail2ban/jail.d/sshd.local <<EOF
[sshd]
enabled = true
port = $SSH_PORT
EOF
systemctl restart fail2ban

# Daily backup at 02:30: database dump + uploaded files, 14 days kept
cat > /usr/local/bin/novasitara-backup <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR=/var/backups/novasitara
STAMP=$(date +%F)
runuser -u postgres -- pg_dump -Fc novasitara > "$DIR/db-$STAMP.dump"
tar -czf "$DIR/files-$STAMP.tar.gz" -C /var/lib/novasitara storage
find "$DIR" -type f -mtime +14 -delete
EOF
chmod 755 /usr/local/bin/novasitara-backup
echo '30 2 * * * root /usr/local/bin/novasitara-backup' > /etc/cron.d/novasitara-backup

echo
echo "Server is ready. Next: run deploy/deploy.sh from your computer, then create the admin (see README)."
