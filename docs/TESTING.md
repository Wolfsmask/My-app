# How to run this on your computer

Everything here runs on your own machine — nothing is sent anywhere and nobody
is contacted.

## The short way (no terminal)

If you just want to use the checker, you need two things:

1. **Install Node** — Step 1 below. One time, five minutes.
2. **Double-click the launcher** in the `app` folder:
   - Windows → `Start MBOnyx.bat`
   - Mac → `Start MBOnyx.command`

The first double-click installs the rest and downloads the browser it audits
with (~150 MB, a few minutes). Every one after that opens straight to a window
in your browser. Leave the black window open while you use it — closing it
stops the checker.

In the window, either paste a list of businesses in yourself, or pick a type of
business and a town and click **Find them for me** — it searches OpenStreetMap
(free, nothing to sign up for) and fills the box so you can see what it found
first. Then **Check these websites**.

> **Mac:** the first double-click may refuse and say the file is from an
> unidentified developer. Right-click it → **Open** → **Open**. Once only.

If the launcher fails, it tells you what's missing and what to do about it —
and the rest of this page is the same steps done by hand, which is also how you
get the extra features (screenshots, AI drafts).

---

## The long way (terminal)

Written assuming you have never used a terminal. About 10 minutes, most of it
waiting for downloads.

---

## Step 1 — Install Node.js (one time)

Node is what runs the checker.

1. Go to **[nodejs.org](https://nodejs.org)**
2. Click the big green button that says **LTS** (it'll say something like "22.x.x LTS")
3. Run the installer. Click Next through everything, accept the defaults.
4. **Restart your computer** — or at least close every terminal window. The
   installer adds Node to your system PATH and already-open terminals won't see it.

---

## Step 2 — Open a terminal

**Windows:** press the Windows key, type `powershell`, press Enter.

**Mac:** press Cmd+Space, type `terminal`, press Enter.

A window with a blinking cursor opens. You type commands here and press Enter
after each one. Check Node installed correctly:

```
node --version
```

You should see something like `v22.11.0`. If you get "not recognized" or
"command not found", Node didn't install properly or you didn't restart.

---

## Step 3 — Download the project

Copy and paste this, one line at a time:

```
cd Desktop
git clone https://github.com/Wolfsmask/My-app.git
cd My-app
git checkout claude/vibrant-knuth-ub2okl
```

**If `git` isn't installed**, download it instead:

1. Go to `https://github.com/Wolfsmask/My-app/tree/claude/vibrant-knuth-ub2okl`
2. Green **Code** button → **Download ZIP**
3. Unzip it to your Desktop
4. In the terminal: `cd Desktop/My-app-claude-vibrant-knuth-ub2okl`

---

## Step 4 — Install what it needs

```
cd app
npm install
npx playwright install chromium
```

The first is quick. The second downloads a copy of the Chrome browser (~150MB)
that the checker uses to open websites. It'll take a minute or two.

> **Why a whole browser?** Because "is this site readable on a phone" is not
> something you can tell from the code. You have to actually open the page at
> phone size and measure it.

---

## Step 5 — Check everything installed

```
npm run doctor
```

You want all green checkmarks in the top section:

```
  ✓ Node.js                v22.11.0
  ✓ package playwright     v1.63.0
  ✓ package @anthropic-ai/sdk v0.127.0
  ✓ package zod            v4.6.5
  ✓ Chromium browser       /Users/you/Library/Caches/ms-playwright/...
```

The **Optional** section underneath will show dots, not checkmarks. That's
correct — those are only for the AI features in Step 7.

If anything shows ✗, the doctor tells you the exact command to fix it.

---

## Step 6 — Run the demo

```
npm run demo
```

This audits 9 example websites served from your own computer. Three are
deliberately terrible, five are the concept builds, one is a modern site.
No internet needed.

You should see:

```
  · Riverside Plumbing        48  Tier C  Not readable on a phone, Looks a decade out of date
  · Copperline Electric        0  Tier D
  ★ Ace Heating and Cooling   81  Tier A  Not readable on a phone, Looks a decade out of date
  · Lumen Dental Studio        0  Tier D
  ...
  Done. A:1  B:0  C:1  D:7  dropped:0
```

At the end it prints a file path. **Open that file in your browser** — it's the
full report with every finding and the measurement behind it.

**That's the whole system working.** If you got here, everything is installed
correctly.

---

## Step 7 — Run it on real businesses

This is the actual test — does it correctly identify real HVAC companies with
bad websites?

### Make your list

1. Google `HVAC Liberty MO` or `HVAC Kansas City`
2. Open a plain text file and paste in 15 of them, one per line

Create a file called `my-list.txt` inside the `app` folder:

```
# Name, website, phone, rating, review count
# Only the website is required — the rest helps the scoring.
Bob's Heating and Air, bobsheatingkc.com, (816) 555-0100, 4.5, 87
Metro Comfort Systems, metrocomfort.net
anotherhvaccompany.com
```

Lines starting with `#` are ignored. Copy the rating and review count straight
off the Google listing — that's what tells the checker whether a business can
actually afford you.

### Run it

```
npm run find -- --source file --input my-list.txt --shots
```

> The `--` after `find` matters. It tells npm the rest is for the checker, not
> for npm itself.

`--shots` saves a screenshot of every site to `out/shots/` so you can see what
the checker saw.

Results land in `app/out/report.html`.

### What to look at

Open the report and ask yourself honestly, for each Tier A and B business:

- **Would I actually pay someone to rebuild this site?**
- **Is the finding true?** Open the site on your own phone and check.
- **Is anything scoring high that's actually fine?** That's a false positive and
  I need to fix the scoring.
- **Is anything scoring low that's obviously terrible?** That's a miss, and it's
  worse than a false positive.

**Send me the report and I'll tune the scoring.** This step is the entire point
of building it before the emailing part.

---

## Step 8 (optional) — The AI parts

These cost real money — about **3 cents per business** — and need a key.

### Get an API key

1. Go to **[console.anthropic.com](https://console.anthropic.com)**
2. Make an account, add a small amount of credit ($5 is plenty for testing)
3. **API Keys** → **Create Key** → copy it

> Account creation needs an adult. This is one of the things to do with your dad,
> same conversation as the payment account.

### Use it

**Mac / Linux:**
```
export ANTHROPIC_API_KEY=sk-ant-your-key-here
npm run find -- --source file --input my-list.txt --vision --draft --notify
```

**Windows PowerShell:**
```
$env:ANTHROPIC_API_KEY="sk-ant-your-key-here"
npm run find -- --source file --input my-list.txt --vision --draft --notify
```

What the new flags do:

| Flag | What it adds |
|---|---|
| `--vision` | Claude looks at each screenshot and judges how it appears to a customer |
| `--draft` | Writes an email for every Tier A lead into `out/drafts/` |
| `--notify` | Prints good leads as it finds them, and logs them to `out/inbox.jsonl` |

**Drafts are never sent.** They're text files for you to read, edit and send
yourself from your own email. There is no sending code anywhere in this project.

Open `app/out/drafts/` and read them. Each file shows the email, whether it
passed the fact-checking, and the findings it was built from. If a draft reads
badly, send it to me and I'll fix the prompt.

---

## When something breaks

**Always run `npm run doctor` first.** It catches most problems and tells you
the fix.

| What you see | What it means |
|---|---|
| `node: command not found` | Node isn't installed, or you didn't restart the terminal |
| `Cannot find module 'playwright'` | You skipped `npm install`, or ran it in the wrong folder |
| `browserType.launch: Executable doesn't exist` | Run `npx playwright install chromium` |
| Launcher window flashes and vanishes | Node isn't installed, or isn't on PATH yet — do Step 1 and restart the computer |
| `--input is required` | You forgot the `--` after `npm run find` |
| Every site scores 0 | Your list file paths are wrong — check the websites actually load |
| `unreachable` next to a business | Their site is down, blocked the checker, or the URL is typo'd |

Still stuck: copy the **whole** error message and send it to me. The last line
is rarely the useful one — I need the lines above it too.

---

## The one thing to remember

**Nothing in this project emails a prospect.** Not the demo, not the drafts, not
the notifications. Sending is a thing you do by hand, from your own inbox, after
reading what you're sending.

That's deliberate, and it stays. The reasons are in `docs/SETUP-CHECKLIST.md`
and `docs/OUTREACH.md`.
