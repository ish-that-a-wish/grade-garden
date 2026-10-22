# Grade Garden

A pastel dashboard for Canvas: your grades, what's due, what's pulling your grades down, a plan for each class, and a **Submit** button that turns work in to Canvas (text, links, or files).

It opens with example courses so you can see it right away. Add your Canvas details and it switches to your real data, refreshing every 2 minutes.

## 1. Get a Canvas access token (2 minutes)

1. Log in to Canvas in your browser.
2. Click **Account → Settings**.
3. Scroll to **Approved Integrations** and click **+ New Access Token**.
4. Purpose: `Grade Garden`. Pick an expiry date if you like. Click **Generate Token**.
5. Copy the token now. Canvas only shows it once.

Also note your Canvas address from the browser bar, e.g. `https://yourschool.instructure.com`.

> Treat the token like your password: anyone who has it can see your grades and submit as you. Some schools turn off student tokens; if there's no "New Access Token" button, ask your school's IT help desk.

## 2a. Run it on your computer

Needs Node.js 20.6 or newer (https://nodejs.org).

```bash
cd grade-garden
cp .env.example .env      # then open .env and fill in your three values
npm install
npm start
```

Open http://localhost:3000.

## 2b. Put it on the web (free, works on your phone)

The easiest host is **Render** (render.com):

1. Put this folder in a GitHub repository (private is fine). `.env` is git-ignored, so your token won't be uploaded.
2. On Render: **New → Blueprint**, pick the repo. It reads `render.yaml`.
3. When asked, fill in `CANVAS_URL`, `CANVAS_TOKEN`, and `APP_PASSWORD`.
4. Render gives you a link like `https://grade-garden.onrender.com`. Add it to your phone's home screen.

**Always set `APP_PASSWORD` when it's online.** Without it, anyone who finds the link can see your grades and submit work. Free Render apps go to sleep when idle, so the first visit after a while takes about 30 seconds.

Railway, Fly.io, or any host that runs `node server.js` works too. Set the same three environment variables.

## What each part does

- **Course cards**: Canvas's current score and letter for each class, with a ring showing the percentage. Tap one to focus the whole page on that class.
- **Due soon**: the next three weeks, grouped by week, with a Submit button whenever Canvas accepts online submissions for that assignment.
- **Priority queue**: missing and upcoming work ranked by how much of your grade you protect per day by doing it now. Set each class's late policy (−X% per day / per week / flat, a maximum, or "no late work") under **Late penalties by class**. The top item is **Up next**; submit it or press **Done** and it pops off. Work Canvas no longer accepts is listed separately so you can email about an exception.
- **Your plan**: set a target for each class. It works out the average you need on the remaining work, lists missing work to turn in first, flags the upcoming assignment that matters most, and points out your weakest category and any assignment worth asking about a retake.

## Notes

- Canvas is the official record. The plan's math uses assignment group weights the same way Canvas does, but teachers can have drop rules or late policies the API doesn't fully expose.
- Submitting asks you to confirm once before anything is sent. Text, link, and file uploads are supported. Quizzes, discussions, and external tools still open in Canvas.
- Drafts you type in the submit box are saved in your browser until you turn them in.
- Your token lives only on the server (in `.env` or the host's environment settings), never in the web page.
