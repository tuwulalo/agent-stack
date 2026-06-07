# AI Chat UI

Next.js web interface for the AI agent (Kimi proxy + Hermes Agent).

## Run locally

```bash
git clone <repo> ai-chat-ui
cd ai-chat-ui
npm install
cp .env.local.example .env.local
npm run dev
# open http://localhost:3002
```

## Production build

```bash
npm run build
npm start
```

## Point it at your own proxy

Set `NEXT_PUBLIC_API_URL` in `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Ports

- Kimi proxy: `:3001` (OpenAI-compatible API)
- Hermes dashboard: `:8081` (Hermes native UI)
- This UI: `:3002` (Next.js chat)
