# AI Chat UI

Next.js веб-интерфейс для AI-агента (Kimi API + Hermes Agent).

## 🌐 Деплой на VPS (уже запущено)

Открывай в браузере: **http://85.93.9.243:3002**

## 💻 Локальный запуск на своем ПК

```bash
# 1. Скопируй проект
git clone <репо> ai-chat-ui
cd ai-chat-ui

# 2. Установи зависимости
npm install

# 3. Скопируй env-файл
cp .env.local.example .env.local

# 4. Запусти
npm run dev

# Открой http://localhost:3002
```

## 🏗 Сборка для production

```bash
npm run build
npm start
```

## 🔧 Подключение к своему API

Если хочешь использовать свой прокси, поменяй `NEXT_PUBLIC_API_URL` в `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## 📡 Что подключено

- **Kimi Proxy** — http://85.93.9.243:3001 (OpenAI-compatible API)
- **Hermes Dashboard** — http://85.93.9.243:8081 (нативный UI Hermes)
- **Этот UI** — http://85.93.9.243:3002 (кастомный Next.js чат)
