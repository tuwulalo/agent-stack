# Безопасный SSH-вход на VPS

Хочется заходить ключом, а не паролем — это и быстрее, и сильно безопаснее.

## 1) Сгенерировать ключ на своём компе

На своём ноутбуке (НЕ на VPS):

```bash
ssh-keygen -t ed25519 -C "tuwulal-vps" -f ~/.ssh/agent-stack
```

Получишь два файла: `agent-stack` (приватный, никому НЕ показывать) и
`agent-stack.pub` (публичный, его кладёшь на VPS).

## 2) Закинуть публичный ключ на VPS

Самый простой способ — `ssh-copy-id`:

```bash
ssh-copy-id -i ~/.ssh/agent-stack.pub root@YOUR_VPS_IP
```

Если `ssh-copy-id` нет:

```bash
cat ~/.ssh/agent-stack.pub | ssh root@YOUR_VPS_IP \
  "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

## 3) Проверить вход по ключу

```bash
ssh -i ~/.ssh/agent-stack root@YOUR_VPS_IP
```

Должен пустить без пароля. ОК — переходи к шагу 4.

## 4) Отключить вход по паролю (после того как ключ работает!)

На VPS отредактируй `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
```

И перезапусти sshd:

```bash
systemctl restart ssh
```

## 5) Удобный alias в ~/.ssh/config (на своём компе)

```sshconfig
Host agent-vps
    HostName YOUR_VPS_IP
    User root
    IdentityFile ~/.ssh/agent-stack
    IdentitiesOnly yes
```

Теперь заходить просто:

```bash
ssh agent-vps
```

## 6) (Опционально) Сменить порт SSH и поставить fail2ban

В `/etc/ssh/sshd_config`:

```
Port 2222
```

И в файрволе:

```bash
ufw allow 2222/tcp
ufw delete allow 22/tcp
```

Поставь fail2ban против перебора:

```bash
apt update && apt install -y fail2ban
systemctl enable --now fail2ban
```

---

**ПРЕДУПРЕЖДЕНИЕ:** прежде чем выключать `PasswordAuthentication`, УБЕДИСЬ что
ключ реально работает. Иначе можно случайно запереть себя снаружи. Держи
второе окно с уже открытой SSH-сессией — если что-то пошло не так,
правишь и перезапускаешь sshd оттуда.
