# SSH key login for the VPS

Key-based login is faster than a password and much harder to brute-force.

## 1) Generate a key on your machine

On your laptop (not the VPS):

```bash
ssh-keygen -t ed25519 -C "agent-stack-vps" -f ~/.ssh/agent-stack
```

You get two files: `agent-stack` (private, never share it) and `agent-stack.pub`
(public, this one goes on the VPS).

## 2) Copy the public key to the VPS

Easiest way is `ssh-copy-id`:

```bash
ssh-copy-id -i ~/.ssh/agent-stack.pub root@YOUR_VPS_IP
```

If `ssh-copy-id` isn't available:

```bash
cat ~/.ssh/agent-stack.pub | ssh root@YOUR_VPS_IP \
  "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

## 3) Test key login

```bash
ssh -i ~/.ssh/agent-stack root@YOUR_VPS_IP
```

It should let you in without a password. If it does, move on to step 4.

## 4) Disable password login (only after the key works)

Edit `/etc/ssh/sshd_config` on the VPS:

```
PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
```

Restart sshd:

```bash
systemctl restart ssh
```

## 5) Add an alias in ~/.ssh/config (on your machine)

```sshconfig
Host agent-vps
    HostName YOUR_VPS_IP
    User root
    IdentityFile ~/.ssh/agent-stack
    IdentitiesOnly yes
```

Now you just run:

```bash
ssh agent-vps
```

## 6) Optional: change the SSH port and add fail2ban

In `/etc/ssh/sshd_config`:

```
Port 2222
```

In the firewall:

```bash
ufw allow 2222/tcp
ufw delete allow 22/tcp
```

Add fail2ban against brute-force:

```bash
apt update && apt install -y fail2ban
systemctl enable --now fail2ban
```

---

**Warning:** before turning off `PasswordAuthentication`, make sure the key
actually works, or you can lock yourself out. Keep a second SSH session open
while you edit sshd config — if something breaks, you can fix it and restart
sshd from there.
