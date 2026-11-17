#!/usr/bin/env bash
# One-time CrewFlow360 setup on the shared Hostinger VPS (Ubuntu 24.04).
# Run as root. Safe to re-run. It only ADDS things: Docker, a "deploy" user,
# /opt/crewflow360, and a new nginx site for crewflow360.com. Existing nginx
# sites and services on this server are left unchanged.
#
# Usage: DEPLOY_PUBLIC_KEY='ssh-ed25519 AAAA... crewflow360-deploy' bash server-setup.sh
set -euo pipefail

: "${DEPLOY_PUBLIC_KEY:?set DEPLOY_PUBLIC_KEY}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y docker.io docker-compose-v2 certbot python3-certbot-nginx
systemctl enable --now docker

id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
grep -qxF "$DEPLOY_PUBLIC_KEY" /home/deploy/.ssh/authorized_keys ||
  echo "$DEPLOY_PUBLIC_KEY" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

install -d -m 750 -o deploy -g deploy /opt/crewflow360
touch /opt/crewflow360/.env
chown deploy:deploy /opt/crewflow360/.env
chmod 600 /opt/crewflow360/.env

cat > /etc/nginx/sites-available/crewflow360 <<'NGINX'
# certbot --nginx adds the HTTPS server block after DNS points here.
server {
    listen 80;
    listen [::]:80;
    server_name crewflow360.com www.crewflow360.com;

    if ($host = www.crewflow360.com) {
        return 308 https://crewflow360.com$request_uri;
    }

    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $http_connection;
        proxy_read_timeout 60s;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/crewflow360 /etc/nginx/sites-enabled/crewflow360
nginx -t
systemctl reload nginx

echo "CrewFlow360 server setup complete."
