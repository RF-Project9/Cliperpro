# 🎬 ViralClip AI — AI Video Clipper for YouTube Shorts

Turn any long YouTube video into ready-to-post **30–60 second viral clips** using OpenAI.

Paste a YouTube link → the app fetches the transcript → OpenAI analyzes every moment → you get a ranked list of viral clips with titles, hooks, hashtags, and an in-place preview that plays the exact segment.

## ✨ Features

- **AI viral detection** — OpenAI scores every moment 0–100 and picks the most viral segments
- **30–60s clips** — each clip is auto-sized for YouTube Shorts
- **Smart metadata** — every clip ships with a catchy title, opening hook, virality reason, and hashtags
- **In-place preview** — YouTube embed plays the exact start→end of each clip
- **Copy & share** — one-click copy for titles and hashtag packs
- **Clip library** — every processed video is saved with all its clips
- **Configurable** — choose model (GPT-4o / 4o-mini / 4.1), clip count, and duration range
- **API key storage** — save your OpenAI key in the app or via environment variable
- **Dark mode** UI built with shadcn/ui + Tailwind 4

## 🛠 Tech Stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS 4** + **shadcn/ui**
- **Prisma ORM** (SQLite)
- **OpenAI** (chat completions, JSON mode)
- **TanStack Query** + **Zustand**

## 🚀 Local Development

```bash
# 1. Install dependencies
bun install

# 2. Copy env and set your OpenAI key (optional — can also be set in the UI)
cp .env.example .env
#   then edit .env and add OPENAI_API_KEY=sk-...

# 3. Push the database schema
bun run db:push

# 4. Start the dev server
bun run dev
```

Open <http://localhost:3000>, paste a YouTube URL, and click **Generate Clips**.

> The video must have captions/subtitles enabled (most popular YouTube videos do).

## 🌐 Deploy to Railway (via GitHub)

This project is pre-configured for Railway with `railway.json` and `nixpacks.toml`.

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: ViralClip AI"
git branch -M main
git remote add origin https://github.com/<your-username>/viralclip-ai.git
git push -u origin main
```

### Step 2 — Create a Railway project

1. Go to <https://railway.app> → **New Project** → **Deploy from GitHub repo**
2. Select your `viralclip-ai` repository
3. Railway auto-detects Next.js and uses the included `nixpacks.toml`

### Step 3 — Add a persistent volume (for the SQLite database)

1. In your Railway service → **Settings** → **Volumes** → **Add Volume**
2. Mount path: `/data`
3. Set the environment variable:
   ```
   DATABASE_URL=file:/data/app.db
   ```

### Step 4 — Set environment variables

In your Railway service → **Variables**, add:

| Variable          | Required | Description                                          |
| ----------------- | -------- | ---------------------------------------------------- |
| `DATABASE_URL`    | ✅       | `file:/data/app.db` (points to the mounted volume)   |
| `OPENAI_API_KEY`  | optional | Your OpenAI key (or set it in the app's Settings UI) |
| `OPENAI_MODEL`    | optional | Default `gpt-4o-mini`                                |

> The `startCommand` in `railway.json` runs `bun run db:push` automatically on every deploy, so the schema is always in sync.

### Step 5 — Deploy

Railway builds and deploys automatically on every push to `main`. Once deployed, open the generated `*.up.railway.app` URL.

## 🔑 OpenAI API Key

- Get one at <https://platform.openai.com/api-keys>
- Add it either:
  - in the app: click **Settings** → paste your key, **or**
  - via env var: `OPENAI_API_KEY=sk-...`

The key is stored in the app's database (local only). On Railway, prefer the environment variable.

## 📁 Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── clips/route.ts          # POST process video, GET list videos
│   │   ├── clips/[id]/route.ts     # GET/DELETE a video + clips
│   │   └── settings/route.ts       # GET/PUT app settings
│   ├── layout.tsx
│   └── page.tsx                    # main dashboard
├── components/
│   ├── clipper/                    # clipper UI components
│   └── ui/                         # shadcn/ui components
└── lib/
    ├── youtube.ts                  # URL parsing + transcript fetching
    ├── openai.ts                   # OpenAI client
    ├── clipper.ts                  # viral clip detection logic
    ├── db.ts                       # Prisma client
    ├── api.ts                      # frontend API client
    ├── queries.ts                  # React Query hooks
    └── store.ts                    # Zustand UI state
prisma/
└── schema.prisma                   # Video, Clip, Setting models
```

## 📝 How It Works

1. **URL parsing** — extracts the YouTube video ID from any link format
2. **Transcript fetch** — pulls the timed transcript (primary: `youtube-transcript`, fallback: direct YouTube scrape)
3. **Metadata** — fetches title & channel via YouTube oEmbed
4. **AI analysis** — sends the full timestamped transcript to OpenAI with a viral-content-strategist prompt; OpenAI returns ranked clips as JSON
5. **Persistence** — saves the video + all suggested clips to the database
6. **Preview** — the UI embeds YouTube with `start` / `end` params so you can watch the exact clip

## 📄 License

MIT — build cool stuff with it.
