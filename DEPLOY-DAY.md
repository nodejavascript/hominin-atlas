# Deploy day — 1 October 2026

**This file was the list of things deliberately NOT done, because the house rule is
that a hostname exists only once it is deployed. It is the record now: what the
deploy took, what went wrong, and what is still outstanding.**

The live site: **https://hominin-atlas.nodejavascript.com/**

---

## 1 · The repository — public, and swept BEFORE it was

`~/.public_repo_sweep.py --repo . --public --history` **failed first, with five
findings**, and every one of them was real:

1. **a personal address** in the working tree — the Wikimedia user-agent in
   `tools/fetch-faces.py` carried a contact address, because Commons asks for one.
   *(The address is deliberately not printed here. This file is in a public
   repository, and naming it in the record of the leak would repeat the leak.)
2. and 3. the same address in **the commit that introduced it** — *"a line deleted
   today is still in the commit that introduced it"*.
4. the address in **documentation prose**.
5. 🔴 **every commit was authored with a personal address.** This is the one nobody
   sees: a repository publishes its commit authors, no file scan reveals them, and it
   is on **every** commit rather than on the one that added the line.

**Fixed properly, not cosmetically.** The tree was fixed first with a comment saying
why a URL is the contact and not an address; then the history was rewritten with
`git filter-repo --replace-text` (the email, in every blob) and `--email-callback`
(the author and committer of all eight commits). The identity is now
`geooogle <105805523+nodejavascript@users.noreply.github.com>` — the same noreply
form `vision-ml-demo` already uses. **`SWEEP OK` afterwards, and the sweep is what
proves it, not the intention.**

> 🔴 **AND IT CAME BACK — which is the lesson worth keeping.** The rewrite fixes HISTORY; the git
> config writes the NEXT commit. **The deploy-day commit and the one after it were authored with a
> personal address** — this machine's user identity — so the address was back in the published
> history **two commits after it had been purged from every earlier one**, and the same two
> addresses were sitting in `DEPLOY-DAY.md` as well, in the paragraph describing the leak.
> *(Those commits are deliberately not cited by hash: the rewrite this describes replaced every
> hash in the repository, so any hash written down here would be dead on arrival.)*
> **The sweep caught it a second time, which is the sweep earning its keep.**
>
> The fix is `git config user.email` **set in the REPOSITORY**: a public repo's commits are then
> clean by construction rather than by remembering. **Set it before the next commit, not after the
> next sweep** — and the history was rewritten a second time, for the same reason the first one was
> needed: an edit today does not remove a line from the commit that introduced it.

Then `gh repo create nodejavascript/hominin-atlas --public --source . --push`.

> ⚠️ **The push failed first, and the reason is worth keeping:** *"Permission to
> nodejavascript/hominin-atlas.git denied to georgefielder"* — the bare
> `github.com` SSH alias uses the **georgefielder** key. The remote for a
> `nodejavascript` repository is **`git@github-nodejs:nodejavascript/hominin-atlas.git`**.

## 2 · DNS

A proxied `A` record for `hominin-atlas` → `178.128.225.32` (the `dvs-sites` droplet),
TTL auto, created through the DNS-scoped token. **No `www` record, and none was
created** — part 7c, checked after the fact with a query for it.

## 3 · The host

A site block on `dvs-sites`, appended to `/etc/caddy/Caddyfile` after backing it up:

```
hominin-atlas.nodejavascript.com {
	import no-ga-for-me
	header Cache-Control "no-store"
	header /manifest.webmanifest Content-Type "application/manifest+json; charset=utf-8"
	root * /srv/hominin-atlas
	import clean-urls
	file_server
	encode gzip
}
```

`caddy validate` → **Valid configuration**, and only then a reload. `no-ga-for-me`
already carries the `?ga=off` / `?ga=on` `X-Robots-Tag` matcher, so nothing new was
needed for that and **nothing was added to `robots.txt`**.

## 4 · Analytics — the property, and the line in the page

* Property **557004013** `hominin-atlas.nodejavascript.com`, in the **`mcp` account**,
  `America/Toronto` and **CAD** — matching all 26 properties already there rather than
  the API's USD default.
* Stream **15939054405** → measurement id **`G-DSBD2WDQ43`**, filled into
  `site/index.html`'s `data-ga-id`.
* Retention **`FOURTEEN_MONTHS`**, read back.
* **Five key events**, read back: `map_ready`, `species_open`, `locality_open`,
  `contact_open`, `timeline_station`. **This site has no form, no signup and no
  purchase**, so `generate_lead` is not one of them and inventing it would have
  registered a conversion that can never happen.

⚠️ **The static suite failed on this change, and it was right to.** Its assertion
read *"carries no id until deploy day"* and required `data-ga-id=""` — the
**pre-deploy state written into a test**. It now asserts a real id, deferred, **and
that the Google tag is not in the page**, which is the half that actually matters.

## 5 · The card on the apex

Registered in `tools/projects.mjs` (with `publicRepo`, because the repository is
public) and `tools/project-details.mjs`, and the card added to the **Maps** group
beside Airplane Watch. `npm run dates` generated its facts from the repository:
`TypeScript · three.js · static page`, and **an empty services list** — a visit makes
no request to anybody else.

**Two gates moved with it, and both are inventories meant to fail:** the card count
**24 → 25**, and the closed stack vocabulary, which gained exactly one word a reader
already knows (`three.js`).

## 6 · What the compliance check found, and what is outstanding

**Two faults, both found by `~/.nodejs_compliance.py` on the day the site went live, and both fixed
the same day.**

* **part 4b — the repository link's LABEL was yellow.** The site's anchors take `--accent-soft`, an
  amber, so the label sat beside the star in a yellow very close to it, and the rule is that **only
  the star may be yellow**. **This is a fact about PAINT, not about source:** the colour lands on the
  element from a rule written somewhere else, so nothing reading the markup can see it — it was
  measured from the rendered page, and it is measured there on every run since. The label now takes
  the footer's own colour — `rgb(246, 239, 232)` against the star's `rgb(251, 191, 36)`.
* **part 6 — there was no live check.** Fixed by **`tools/live-check.mjs`** (`npm run test:live`, 19
  checks): the deployed host is asked for the 200, the `no-store` shell, the title, the icon set and
  the order it is declared in, `robots.txt`, the sitemap, the absence of `www`, the rendered
  part-4b colours, and no third-party request before an answer. It compares the **served** `app.js`
  and `styles.css` with the local build, so **a stale deploy fails there rather than being found by
  a visitor.**

**Done, and no longer outstanding:**

* **Search Console** — both property kinds added the day the site went live, and the sitemap
  submitted to both. The URL-prefix property verified over `ANALYTICS`; the `sc-domain:` property
  over Cloudflare DNS.
* **The registers** — the theme register, the host/property check and the SEO audit all ran against
  the live host. **The theme colour changed because of that run:** `#ea580c` was already
  `recallradar`'s, so it became `#ca8a04`, and the icons were redrawn with it — the mark wears the
  site's own colour, so a recolour without an icon redraw leaves the tab and the page disagreeing.
  All four dimensions — colour, background, abstract, Analytics id — are now this site's own.
* **Rollbar — DECIDED AGAINST, deliberately, and this is the reason:** the site ships
  no third-party script at all, and `test/e2e.test.js` counts the requests a visit
  makes and asserts there are none to Google before an answer. Adding an error
  reporter would put a third-party request on every page load and contradict both
  the site's own position and its test. **A project with no client is useless, so
  there is no Rollbar project here** — not an oversight, a choice, and the same
  choice record 7 below already describes.

---

## 🔴 The three things that went wrong, because all three will happen to the next site

1. 🔴 **THE ONE THAT COST FOUR HOURS: A TYPO IN THE DNS RECORD, AND I NEVER READ THE NAME
   CADDY WAS ACTUALLY ASKING FOR.** The site is **hominin**-atlas — *hominin*, the tribe.
   The record was created as **hinomin**-atlas. So Caddy asked Let's Encrypt for a
   certificate for a hostname that had no record, and Let's Encrypt answered `NXDOMAIN`
   — **correctly, every time, for four hours.**

   **And the diagnosis was thorough and useless, because it was aimed at the wrong name.**
   I checked that the record resolved: both Cloudflare nameservers, four public resolvers
   and Google's DNS-over-HTTPS all returned `172.64.80.1` — **for `hinomin-atlas`.** I
   concluded that Let's Encrypt was broken, and went looking for an issuer that did not
   depend on it. **The record was fine. It was a record for nothing.**

   **The fix took one command — create the record under the right name — and the
   certificate arrived nine seconds later.** The lesson is not "spell carefully". It is:
   **read the name out of the thing that is FAILING, not out of your own intention.**
   Caddy's log printed `hominin-atlas` on every line. The site's title, its canonical URL,
   its `package.json` and its directory all said `hominin-atlas`. **The only place the
   wrong spelling appeared was the request I made myself.**

2. **A DNS negative cache can block a certificate while the record is perfectly correct.**
   Caddy asked Let's Encrypt **thirteen seconds** after a record was created; Let's
   Encrypt's resolver got `NXDOMAIN` and may hold it for up to **Cloudflare's `SOA
   MINIMUM`, which is 1800 seconds.** So create the record and let the certificate job
   have its time. *(This is real, but it was NOT what happened here — see 1. It is worth
   knowing, and it is the wrong thing to reach for first.)*

3. **A Caddy reload cancels an in-flight certificate job.** Deploying the apex runs
   `systemctl reload caddy` on this same droplet, and it produced *"obtaining
   certificate: context canceled"* for this site. **A reload takes the running TLS job
   with it**, so a deploy anywhere on this box can cancel a certificate that was
   mid-flight for somewhere else. **Sequence the two, or accept the restart.**

**All three are written down because the job of this file is to stop the next agent
repeating them.** The site works; the four hours were the cost of checking my own intent
instead of the artefact.

---

## 7 · What is true of this site, and stays true

* **Nothing is loaded from a third party.** three.js, the coastlines, the bathymetry
  and every species picture are all served from this domain — the pictures are
  downloaded from Wikimedia Commons at **build** time into `site/avatars/`.
* **A visit that refuses makes no request to Google and sets no cookie** — counted off
  the network by the end-to-end suite, not read out of the source.
* **No `privacy.html`** — the policy is a `#privacy` section of the page.
* **No `www`,** no `.html` in any URL, no Back to top, and the repository line carries
  the star in the page's own yellow.
* **The theme is its own in all four dimensions:** `#ca8a04` over `#140704`, a
  repeating field of chevrons as the abstract, and its own Analytics id.
