# Outreach Playbook

How to email a stranger about their website without sounding like a bot — and without
being one.

The checker finds who to contact. This decides whether they reply.

---

## 1. Why most cold email fails

A business owner gets 15–25 of these a week. They have learned to delete them in under a
second, without reading. They are not judging your offer — they are pattern-matching on
whether a human wrote it.

### The tells that get you deleted instantly

| Tell | Why it reads as a bot |
|---|---|
| "I hope this email finds you well" | No human has ever said this out loud |
| "I came across your website and was impressed" | Impressed by *what*? You clearly didn't look |
| "We are a leading provider of digital solutions" | Nobody describes themselves this way to a person |
| "Dear Sir/Madam" or "Hi [First Name]" | Obviously a mail merge |
| A bulleted list of your services | You're talking about you. They don't care about you |
| Three links, a logo, an HTML signature block | Real people send plain text |
| "a quick 15-minute call to discuss your needs" | This exact phrase is in every spam email ever sent |
| Perfect corporate grammar, 300 words | Real emails between busy people are 4 sentences |
| Sent at 3:14am | A person was asleep. A script was not |

### What a real email looks like

Short. Specific. One fact that could only be true about *them*. One question that takes
five seconds to answer. No signature block.

**The reason this works is not clever writing. It's that you did the work first.**

---

## 2. The one rule that makes it not-botish

> **Every email must contain a fact that is impossible to mass-produce.**

"Your website could be improved" is mass-producible. Delete.

"Your homepage is 980 pixels wide and my phone screen is 390, so I had to pinch and drag
to read your service list" is not. Somebody actually looked.

This is exactly what the checker produces. Every finding in the report comes with measured
evidence — that sentence *is* your first line. You're not writing 200 emails. You're
writing one email 200 times, with the true part swapped in.

**Never send a finding you have not verified yourself.** If the checker says the SSL
expired, open the site and see the warning with your own eyes before you claim it. One
wrong fact and you are a bot that also lies.

---

## 3. The template

Four sentences. That is the whole thing.

```
Subject: your site on my phone

Hi —

I was looking up HVAC companies around Liberty and opened
acehvac.com on my phone. The page is about 980px wide on a
390px screen, so I had to pinch and zoom to read your service
list.

I rebuilt your homepage to see what it'd look like fixed:
mbonyx.com/audit/ace-heating

Took me an afternoon. If it's useful, I can do the whole site.
If not, no worries at all — delete this.

Micah
```

### Why each part works

| Part | Job |
|---|---|
| **"your site on my phone"** | Lowercase, five words, sounds like a person. Not "Improving Your Online Presence" |
| **"I was looking up HVAC companies around Liberty"** | Says honestly how you found them. Doesn't pretend to be a customer |
| **The measurement** | The unfakeable part. Numbers prove you looked |
| **"I rebuilt your homepage"** | You already did the work. This is the whole pitch |
| **One link** | More than one looks like marketing |
| **"delete this"** | Removes all pressure. Counter-intuitively raises replies — you sound confident, not desperate |
| **First name, no signature block** | A logo and a job title in a cold email screams template |

### Variants by finding

**Expired security certificate** *(urgent — they usually don't know)*
```
Subject: heads up, your site shows a security warning

Hi — your security certificate expired on March 3rd, so Chrome
is showing a full-page "Not Secure" warning before anyone can
see your site. Screenshot: mbonyx.com/audit/ace-heating

Whoever hosts it can renew it, probably for free. I'm not
trying to sell you anything on this one — figured you'd want
to know.

Micah
```
This one genuinely should not sell. Fix-it-free emails build more goodwill than any pitch,
and a decent number reply asking what else is wrong. **That reply is the sale.**

**Stale copyright + old platform**
```
Subject: quick thing about your site

Hi — your site's footer still says 2019 and it's running on a
version of WordPress that stopped getting security updates a
while back. First-time visitors read a stale year as "might be
closed."

I put together what a current version could look like:
mbonyx.com/audit/ace-heating

Worth a look?

Micah
```

---

## 4. Rules for sending

| Rule | Why |
|---|---|
| **Plain text only.** No HTML, no images, no tracking pixel | HTML email from an unknown sender goes to spam far more often |
| **Send Tue–Thu, 9–11am their time** | Monday is triage, Friday is checked out |
| **Never send at night.** Schedule it | 3am send = obvious script |
| **Max 40/day from one address**, and only after a 4-week warmup | See `APP_PLAN.md` §6. Skip this and your domain is dead |
| **One follow-up. Then stop forever** | Two emails is outreach. Five is harassment, and gets you reported |
| **Reply from a real mailbox you actually read** | `noreply@` is a spam signal and wastes the replies you earn |
| **Read every email out loud before sending** | If you would not say it to someone's face, rewrite it |

### The single follow-up

Send once, 4–5 days later, replying to your own original so the thread stays together:

```
Hi — just floating this back up in case it got buried.
Happy to leave it if you're not interested.
```

Two sentences. Then the record goes to `do_not_contact` permanently.

---

## 5. When someone replies

This is where the money is, and where most people fall apart.

### "How much?"

Do **not** dodge into a call. Answer directly:

```
For a site your size it'd be $1,800 — that's five pages,
everything mobile-first, contact form, hooked into your Google
listing. Half up front, half at launch. Usually about two weeks.

Happy to put a proper quote together if you want specifics.
```

Dodging the price is the most common reason a warm lead goes cold. They asked a question.
Answer it.

### "Who are you / how long have you been doing this?"

Tell the truth, briefly, then move the conversation back to the work:

```
I run MBOnyx Studio — it's just me. You can see a few builds
here: mbonyx.netlify.app/#work

Happy to talk through what your site would need whenever suits.
```

**If they ask your age directly, say it.** Getting caught lying mid-project costs you the
client and every referral they'd ever have made. Some will pass. Plenty won't, because
they can already see the work.

### "Not interested"

```
No problem — thanks for letting me know. Good luck this season.
```

Then add them to the suppression list and never contact them again. Ever. A gracious exit
gets you referred more often than you'd think.

### Silence

One follow-up. Then stop. They are not thinking about you.

---

## 6. The audit page does most of the selling

The email's only job is to get the click. The page has to close.

For each Tier A lead, the generated page should show:

1. **Their current homepage on a phone, screenshotted** — the problem, visible in one glance
2. **Your rebuilt version beside it** — same content, working
3. **The three findings with real numbers** — what's broken and what it costs them
4. **One line of close** — "this took an afternoon; the real thing takes a week"

No pricing tables. No "packages". No forms. One reply-to-email link.

**Crucially: the rebuild must use their real business name, real phone number, real
services and real hours** — all of which the discovery step already pulled. A demo with
"Your Business Name Here" in it proves nothing. A demo with *their* name on it is the
moment they start imagining owning it.

---

## 7. What you're actually allowed to promise

Never claim:
- A specific Google ranking
- A specific number of new customers
- "Guaranteed results"

You can honestly promise:
- It will load in under two seconds — **measurable, and you can prove it**
- It will work on every phone — **measurable**
- It will be finished in the timeframe you quoted
- You will fix bugs in your own code free for 30 days

Promising the measurable and refusing to promise the unmeasurable is itself a trust
signal. Everyone else overpromises. Being the one who says "I can't guarantee you'll rank
first, nobody honestly can" is memorable.

---

## 8. Before you send a single cold email

- [ ] Postal address exists (PO Box) — legally required in commercial email
- [ ] Separate outreach domain bought and warmed 4 weeks
- [ ] SPF, DKIM and DMARC records configured
- [ ] Working unsubscribe link and `List-Unsubscribe` header
- [ ] Suppression list checked automatically before every send
- [ ] Two paying clients already landed through warm introductions

That last one is not optional. Cold email works far better when your site has real
testimonials on it — and warm intros are how you get those. See
`SETUP-CHECKLIST.md` §7.
