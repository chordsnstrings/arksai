#!/usr/bin/env bash
# One-time installer for ArksAI auto-deploy. Run once on the Droplet:
#   cd /opt/arksai && bash scripts/install-autodeploy.sh
# After this, every push to origin/main is pulled, rebuilt, and deployed
# automatically (checked every 2 minutes). Manage with:
#   systemctl status arksai-deploy.timer
#   journalctl -u arksai-deploy.service -f      # watch deploy logs
#   systemctl disable --now arksai-deploy.timer # stop auto-deploy
set -euo pipefail

REPO=/opt/arksai
chmod +x "$REPO/scripts/autodeploy.sh"

cat > /etc/systemd/system/arksai-deploy.service <<EOF
[Unit]
Description=ArksAI auto-deploy (pull + rebuild on new commits)
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$REPO
ExecStart=/usr/bin/env bash $REPO/scripts/autodeploy.sh
EOF

cat > /etc/systemd/system/arksai-deploy.timer <<EOF
[Unit]
Description=Run ArksAI auto-deploy every 2 minutes

[Timer]
OnBootSec=60
OnUnitActiveSec=120
Unit=arksai-deploy.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now arksai-deploy.timer

echo "✓ Auto-deploy installed and running."
echo "  It checks origin/main every 2 min and redeploys on new commits."
echo "  Watch it:   journalctl -u arksai-deploy.service -f"
echo "  Run now:    systemctl start arksai-deploy.service"
echo "  Stop it:    systemctl disable --now arksai-deploy.timer"
