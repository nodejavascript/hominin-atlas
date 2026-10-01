# Deploy day

**The site is built and tested locally. Nothing here is deployed.**

This file is the list of things that are deliberately NOT done yet, because the
house rule is that a hostname exists only once it is deployed: the DNS record, the
Analytics property, the Search Console properties and the card on the apex are all
created **together, on the day**, not in advance.

Work through it in this order.

---

## 1 · The repository

The footer prints `github.com/nodejavascript/hominin-atlas`, so the repository must
exist before the page goes live.

```bash
cd ~/Documents/git/github.com/nodejavascript/hominin-atlas
git init -b main
git add -A && git commit -m "hominin-atlas: an atlas of every hominin on one globe"
gh repo create nodejavascript/hominin-atlas --public --source . --push
```

House part 12: a **public** repo lives on GitHub under `nodejavascript`, and if it
had been on GitLab the GitLab project is removed. Before pushing:

```bash
~/.public_repo_sweep.py --repo . --public --history
```

## 2 · DNS and the host

* Cloudflare zone `nodejavascript.com` — a proxied `A` record for
  `hominin-atlas` → `178.128.225.32` (the `dvs-sites` droplet).
* **No `www` record. Ever.** Part 7c, and `~/.nodejs_host_property_check.py` gates it.
* Caddy on `dvs-sites`: a site block for `hominin-atlas.nodejavascript.com`
  serving `/srv/hominin-atlas`, with the `(clean-urls)` snippet imported and
  `Cache-Control: no-store` on `/` (part 7 — a deploy must be visible).
* Add the `?ga=off` / `?ga=on` **`X-Robots-Tag: noindex, nofollow`** matcher to the
  block. Do **not** add them to `robots.txt`: a `Disallow` stops Google reading the
  canonical, which is the mechanism that consolidates the control URLs.

```bash
rsync -a --delete site/ dvs-sites:/srv/hominin-atlas/
```

## 3 · Analytics — and the line in the page

The page ships `<script src="./consent.js" data-ga-id="" defer>`. **The empty id is
deliberate.** Create the property, then fill it:

1. GA4 property in the **`mcp` account (84487458)**, named with the full domain,
   retention `FOURTEEN_MONTHS`, key events registered.
2. Put the measurement id into `site/index.html`'s `data-ga-id`.
3. `npm test` — the static suite asserts the attribute is present and deferred.
4. Redeploy.

Nothing loads until this is done, which is correct: with no id the gate finds
nothing, loads nothing, and the page is a site with no analytics at all.

## 4 · Search Console

Both kinds of property, and the sitemap submitted to both:

```bash
.venv/bin/python3 ~/.searchconsole_setup.py
.venv/bin/python3 ~/.seo_audit.py --site hominin-atlas.nodejavascript.com
.venv/bin/python3 ~/.searchconsole_audit.py
```

## 5 · The card on the apex

Part 11: every app on the domain has a card on `nodejavascript.com`, added on the
day it is deployed and kept current with the app. The card's facts (last-committed
day, stack, outside services) are **generated from the repository**, never typed.

## 6 · The registers

```bash
python3 ~/.nodejs_theme_register.py     # theme colour, background, drawing, GA id
python3 ~/.nodejs_compliance.py --save  # the compliance check
python3 ~/.nodejs_host_property_check.py
```

Then the Rollbar project, so errors have somewhere to go.

## 7 · What is already true of this site, so it is not forgotten

* **Nothing is loaded from a third party.** three.js, the coastlines and the fonts
  are all served from this domain. No Google font, no content delivery network.
* **A visit that refuses makes no request to Google and sets no cookie.** Counted
  off the network by `test/e2e.test.js`, not read out of the source.
* **No `privacy.html`** — the policy is a `#privacy` section of the page.
* **No `www`,** no `.html` in any URL, no Back to top, and the repository line
  carries the star in the page's own yellow.
* **The theme is its own in all four dimensions:** `#ea580c` over `#140704`, a
  repeating field of chevrons as the abstract, and its own Analytics id.
