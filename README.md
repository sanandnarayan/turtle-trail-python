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
- `public/python-worker.mjs` — Python runtime and browser Turtle adapter
- `app/globals.css` — visual design and responsive layout
- `worker/index.ts` — Cloudflare Worker entry point

## Useful commands

```bash
npm run dev       # local development
npm run build     # production build
npm run lint      # code-quality checks
npm run deploy    # build and deploy to Cloudflare
```
