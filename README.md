# Turtle Trail

Turtle Trail is a child-friendly, one-concept-at-a-time Python course. Learners
edit and execute real Python in the browser, then see their Turtle commands
drawn on an animated canvas.

The course includes 12 progressive lessons covering imports, arguments,
variables, `for` and `while` loops, conditions, functions, parameters, lists,
and modules. Progress and unfinished code are stored locally in the browser.

The separate **Clock Quest** course at `/clock` adds nine graded missions for
building a live analog clock with Turtle. Learners draw the face and hour
numbers, add each hand, connect them to `datetime`, refactor repeated drawing
steps into a function, and earn persistent points as they progress.

Learners can use the courses anonymously with browser-local progress or sign in
through an emailed one-time link. Signed-in lesson answers, unlocks, and scores
are synchronized to Cloudflare D1 and merged with existing progress when a
learner signs in on a new device.

## Requirements

- Node.js 22.13 or newer
- A free or paid Cloudflare account

## Run locally

```bash
npm ci
npm run dev
```

Open the local address printed in the terminal.

## Deploy to Cloudflare Workers

First authenticate Wrangler with the Cloudflare account that should own the
site:

```bash
npx wrangler login
```

Then build and deploy:

```bash
npm run deploy
```

### Progress accounts

The Worker uses the `turtle-trail-progress` D1 database configured in
`vite.config.ts`. Build first, then apply database migrations before the first
deployment:

```bash
npm run build
npx wrangler d1 migrations apply turtle-trail-progress --remote \
  --config dist/server/wrangler.json
```

Email sign-in uses [Resend](https://resend.com). Verify the sending domain in
Resend, then configure these Worker secrets without committing their values:

```bash
npx wrangler secret put RESEND_API_KEY --config dist/server/wrangler.json
npx wrangler secret put RESEND_FROM_EMAIL --config dist/server/wrangler.json
```

`RESEND_FROM_EMAIL` accepts a verified sender such as
`Turtle Trail <learn@resend.codeanand.com>`. For local Wrangler development, put the
same names in an ignored `.dev.vars` file.

Magic links expire after 15 minutes, can only be used once, and are stored as
SHA-256 hashes. Sessions use secure, HTTP-only cookies and expire after 30 days.

Wrangler prints the final `workers.dev` URL. You can attach a custom domain
from **Cloudflare Dashboard → Workers & Pages → turtle-trail-python →
Settings → Domains & Routes**.

For deployment from GitHub, import the repository under **Workers & Pages** and
use:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Production branch: `main`

## How Python execution works

`public/python-worker.mjs` loads Pyodide in a web worker. Learner code runs
away from the UI thread with time, output, source-size, and drawing-command
limits. A small browser-compatible Turtle module records drawing instructions,
which the React interface renders on a canvas. Lesson grading combines actual
execution results with targeted syntax checks.

The Python runtime is loaded from jsDelivr, so the learner needs an internet
connection when opening the course for the first time.

## Main files

- `app/turtle-course.tsx` — lessons, checks, editor, progress, and canvas
- `app/account.tsx` — magic-link UI and local-to-server progress synchronization
- `public/python-worker.mjs` — Python runtime and browser Turtle adapter
- `app/globals.css` — visual design and responsive layout
- `worker/api.ts` — authentication, session, and D1 progress API
- `worker/index.ts` — Cloudflare Worker entry point and API routing
- `migrations/` — D1 authentication and progress schema

## Useful commands

```bash
npm run dev       # local development
npm run build     # production build
npm run lint      # code-quality checks
npm run deploy    # build and deploy to Cloudflare
```
