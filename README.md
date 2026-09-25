<<<<<<< HEAD
# MathWizard
=======
# Markdown pages from GitHub

A Next.js site that renders Markdown files from a GitHub repository as web pages, with a landing page that lists them all. The site's code and the Markdown live in separate repositories.

The same code can be deployed two ways:

- **GitHub Pages (static).** A workflow builds every page into plain HTML and publishes it. When the content repository changes, its own workflow triggers a rebuild, which takes a minute or two.
- **Next.js server** (`next start`). Pages are cached, and a push refreshes only the pages it changed, within seconds, through the `/api/revalidate` webhook.

You can use either or both; the content repository's workflow notifies whichever you've set up.

## How it works

1. `/<slug>` renders `<GITHUB_CONTENT_DIR>/<slug>.md` from `GITHUB_BRANCH`, fetched through the GitHub REST API with Octokit. The YAML front-matter is parsed with gray-matter and the body is converted to sanitized HTML. `/` lists every published page, newest first.
2. The build renders the landing page and every published page ahead of time. On a server, GitHub's responses are also cached under per-page tags (`page-<slug>`), so later visits don't call GitHub.
3. On a server, `POST /api/revalidate` receives push events. It checks the signature, works out which `.md` files were added, modified or removed, and refreshes those pages and the landing page. The next visit shows the new version.

Missing files and pages marked `published: false` return a 404.

## Local setup

Requires Node.js 20.9 or later.

```bash
npm install
cp .env.example .env.local   # fill in the values; each one is explained in the file
npm run dev
```

Open http://localhost:3000 for the landing page, or `/<slug>` for a single page.

`npm run build` reads the content repository, because it renders every page up front, so the GitHub variables must be set when you build, not only when the server runs. To preview the GitHub Pages build locally, run `STATIC_EXPORT=true npm run build`; the site is written to `out/`.

## Writing pages

A file's name is its URL: with `GITHUB_CONTENT_DIR=content`, `content/getting-started.md` is served at `/getting-started`. File names may contain letters, digits, `-`, `_` and `.`, and must start with a letter or digit. Files in subfolders of the content folder aren't served.

```yaml
---
title: Getting started                       # defaults to the file name: "Getting Started"
description: Install and configure the app.  # shown under the title, on the landing page and in search results
author: Jane Doe
date: 2025-01-31                             # the landing page lists newest first; undated pages go last
published: true                              # false hides the page (404) without deleting it
---
```

- The page title comes from the front-matter, so don't also start the body with a `# Title` heading.
- Link to other pages as `/getting-started`. These links keep working when GitHub Pages serves the site from `/<repository>/`; relative links like `getting-started` don't.
- Pages support GitHub-flavored Markdown (tables, task lists, footnotes, strikethrough) and safe inline HTML such as `<details>`. Scripts, event handlers, iframes, inline styles and `javascript:` links are removed. JavaScript front-matter (`---js`) is rejected, because gray-matter would otherwise execute it.
- A file whose front-matter can't be parsed is left off the landing page and out of the GitHub Pages build, and the build log names it. On a server, visiting it returns a 500.

The landing page's heading and description are `SITE_NAME` and `SITE_DESCRIPTION` at the top of `app/page.js`.

## Publishing on GitHub Pages

The site's repository contains `.github/workflows/deploy-pages.yml`. The comments at the top of that file cover the one-time setup:

1. In the site repository: **Settings → Pages → Source: GitHub Actions**, then add the variables `CONTENT_OWNER` and `CONTENT_REPO` (optionally `CONTENT_BRANCH` and `CONTENT_DIR`), plus a `CONTENT_TOKEN` secret if the content repository is private.
2. Copy `content-repo/.github/workflows/publish-site.yml` into the **content** repository, then set its `SITE_REPOSITORY` variable and `SITE_DISPATCH_TOKEN` secret.

After that, every push that changes Markdown in the content repository rebuilds and republishes the site. You can also start a rebuild from the site repository's **Actions** tab.

## Running on a server

Deploy with `npm run build && npm start` (or any host that runs Next.js), with the variables from `.env.example` set for both commands. Then tell the server about pushes in one of two ways, but not both:

- **From the content repository's workflow:** set its `REVALIDATE_URL` variable (`https://<your-domain>/api/revalidate`) and `WEBHOOK_SECRET` secret. The same workflow also keeps GitHub Pages up to date if you use both.
- **With a repository webhook:** see the setup notes at the top of `app/api/revalidate/route.js`.

To test the endpoint by hand, with `GITHUB_CONTENT_DIR=content` and `WEBHOOK_SECRET` exported in your shell:

```bash
payload='{"ref":"refs/heads/main","repository":{"full_name":"OWNER/REPO"},"commits":[{"added":[],"modified":["content/hello-world.md"],"removed":[]}]}'
signature="sha256=$(printf '%s' "$payload" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $NF}')"

curl -X POST http://localhost:3000/api/revalidate \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -H "X-Hub-Signature-256: $signature" \
  -d "$payload"
# {"ok":true,"revalidated":["hello-world"]}
```

## Things to know

- **Force pushes** make the server refresh every page, as does deleting or recreating the branch, because the push doesn't list every file that changed.
- **When GitHub is down**, a server keeps serving cached pages. A page that needs a fresh copy (never visited, or first visit after a push) returns a plain-text HTTP 500 until GitHub is reachable again, and the server log says why: bad token, rate limit, timeout and so on. On GitHub Pages, a failed build simply leaves the previous version online.
- **Every page returns 404?** GitHub also returns 404 when the branch doesn't exist or when the token can't read a private repository. Check the owner, repository, branch and token access.
- **Several server instances:** each keeps its own cache and a webhook reaches only one of them, so configure a shared cache handler (see "Multi-Instance Cache Coordination" in the Next.js self-hosting guide). If a CDN caches the HTML, it must be purged too, because pages are sent with a one-year `s-maxage`.

## Project structure

```
app/page.js                          Landing page: every published page, newest first
app/[slug]/page.js                   Page route: title, description, author and date, then the rendered Markdown
app/api/revalidate/route.js          Webhook endpoint for server deployments (setup notes at the top)
app/not-found.js                     404 page
components/page-meta.js              "By <author> · <date>" line
lib/github-cms.js                    Configuration, GitHub fetching and caching, front-matter, page list
lib/github-webhook.js                Signature verification; push payload → changed slugs
lib/markdown.js                      Markdown → sanitized HTML
next.config.mjs                      Switches to a static export for GitHub Pages
.github/workflows/deploy-pages.yml   Builds and publishes the site to GitHub Pages
content-repo/.github/workflows/      Workflow to copy into the content repository
```
>>>>>>> 16af36b (full complete website)
