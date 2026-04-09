# MyPMS

MyPMS is a web application for hotel front desk and operations management.
The project is built with React, TypeScript, and Vite, with Supabase as the backend.

## Features

- Guest and booking workflows
- Room occupancy and cleaning workflows
- Sticky notes for operations team communication
- Role-based access (admin, concierge, housekeeper)

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Supabase (Auth, Database, Edge Functions)

## Requirements

- Node.js 20+
- npm 10+ (or compatible)
- Supabase project with configured API keys

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env.local
```

3. Fill required variables in `.env.local`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_or_publishable_key
```

4. Start development server:

```bash
npm run dev
```

5. Open in browser:

`http://localhost:5173`

## Available Scripts

- `npm run dev` - start local dev server
- `npm run build` - create production build
- `npm run preview` - preview production build locally
- `npm run lint` - run lint checks
- `npm run migrate:data` - run migration script from `scripts/migrate-data.mjs`

## Production Build

```bash
npm run build
npm run preview
```

## Supabase Notes

- Keep `.env.local` private and never commit secrets.
- `SUPABASE_SERVICE_ROLE_KEY` is only for migration script usage and should never be exposed to the frontend.
- For invitation/login flows, configure redirect URL in Supabase Auth settings:
  - `https://<your-frontend-domain>/login`

## Git Workflow

Push latest changes:

```bash
git add .
git commit -m "Your commit message"
git push
```
