import 'server-only';
import { cache } from 'react';
import { Octokit } from '@octokit/rest';
import matter from 'gray-matter';
import { renderMarkdown } from './markdown';

/** Tag on every page's cached GitHub response, used to purge the whole site at once. */
export const ALL_PAGES_TAG = 'github-cms';

/** Tag on the cached folder listing that the landing page is built from. */
export const PAGE_LIST_TAG = 'page-list';

const GITHUB_TIMEOUT_MS = 10_000;

// GitHub's contents API lists at most this many entries per folder.
const MAX_FOLDER_ENTRIES = 1000;

// Parallel requests when loading every page for the list; GitHub penalizes large bursts.
const LIST_CONCURRENCY = 8;

// Letters, digits, ".", "-" and "_"; must start with a letter or digit. No "/" means
// no path traversal, and the length cap keeps `page-${slug}` under Next's 256-char tag limit.
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

const rejectJavaScriptFrontMatter = () => {
  throw new Error('JavaScript front-matter (---js) is not allowed');
};

const GRAY_MATTER_OPTIONS = {
  // gray-matter eval()s "---js" front-matter by default, which would let anyone
  // with push access run code on this server. Passing any options object also
  // disables gray-matter's unbounded in-memory cache of every file it has parsed.
  engines: { js: rejectJavaScriptFrontMatter, javascript: rejectJavaScriptFrontMatter },
};

export class GitHubCMSError extends Error {
  /** @param {string} message @param {{ status?: number, cause?: unknown }} [options] */
  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.name = 'GitHubCMSError';
    this.status = status;
  }
}

/** A file whose front-matter can't be parsed: an authoring mistake rather than an outage. */
export class FrontMatterError extends GitHubCMSError {
  constructor(message, options) {
    super(message, options);
    this.name = 'FrontMatterError';
  }
}

/** Reads and validates the GitHub settings from the environment (see .env.example). */
export function getConfig() {
  const owner = process.env.GITHUB_OWNER?.trim();
  const repo = process.env.GITHUB_REPO?.trim();
  if (!owner || !repo) {
    throw new GitHubCMSError('GITHUB_OWNER and GITHUB_REPO must be set. See .env.example.');
  }
  return {
    owner,
    repo,
    branch: process.env.GITHUB_BRANCH?.trim() || 'main',
    // "content", "/docs/pages/" → "docs/pages"; empty means the repository root.
    contentDir: (process.env.GITHUB_CONTENT_DIR ?? '').trim().replace(/^\/+|\/+$/g, ''),
    token: process.env.GITHUB_TOKEN?.trim() || undefined,
    apiUrl: process.env.GITHUB_API_URL?.trim() || undefined,
  };
}

export function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug);
}

/** Cache tag for a single page; the webhook revalidates this after a push. */
export function pageTag(slug) {
  return `page-${slug}`;
}

function filePathForSlug(slug, contentDir) {
  return contentDir ? `${contentDir}/${slug}.md` : `${slug}.md`;
}

/**
 * Maps a repository file path back to its slug ("content/hello-world.md" →
 * "hello-world"). Returns null for anything that isn't a routable page: files
 * outside the content directory, nested files, and non-.md files.
 */
export function slugFromFilePath(filePath, contentDir) {
  const prefix = contentDir ? `${contentDir}/` : '';
  if (!filePath.startsWith(prefix) || !filePath.endsWith('.md')) return null;
  const slug = filePath.slice(prefix.length, -'.md'.length);
  return isValidSlug(slug) ? slug : null;
}

let octokit;

function getOctokit({ token, apiUrl }) {
  octokit ??= new Octokit({
    auth: token, // optional for public repos, but unauthenticated calls are limited to 60/hour
    baseUrl: apiUrl,
    // Octokit logs every failed request, including the 404s we expect for missing
    // pages. Real failures are rethrown below with more context instead.
    log: { error: () => {} },
  });
  return octokit;
}

/**
 * Octokit accepts a custom fetch. Routing its request through Next.js' patched
 * fetch stores GitHub's response in the Data Cache under these tags, so the
 * webhook can purge a single page with `revalidateTag()`.
 */
function taggedFetch(tags) {
  return (url, init) => fetch(url, { ...init, cache: 'force-cache', next: { tags } });
}

function toCMSError(error, filePath) {
  const { status } = error;
  const headers = error.response?.headers ?? {};
  // No response means the request never completed (network error or timeout).
  let reason = error.response ? `GitHub responded with ${status}: ${error.message}` : error.message;

  if (status === 401) {
    reason = 'GitHub rejected the token (401). Check GITHUB_TOKEN.';
  } else if ((status === 403 || status === 429) && headers['x-ratelimit-remaining'] === '0') {
    const resetsAt = Number(headers['x-ratelimit-reset']) * 1000;
    reason = resetsAt
      ? `GitHub API rate limit exceeded; it resets at ${new Date(resetsAt).toISOString()}.`
      : 'GitHub API rate limit exceeded.';
  }

  return new GitHubCMSError(`Could not load "${filePath}" from GitHub. ${reason}`, {
    status,
    cause: error,
  });
}

/** Returns the raw Markdown, or null if the file doesn't exist on the branch. */
async function fetchMarkdown(slug, filePath, config) {
  try {
    const { data } = await getOctokit(config).rest.repos.getContent({
      owner: config.owner,
      repo: config.repo,
      path: filePath,
      ref: config.branch,
      // Return the file itself rather than base64 JSON (which is also capped at 1 MB).
      // This uses the REST API, not raw.githubusercontent.com, because that CDN can
      // serve content up to 5 minutes old and would undo the webhook's revalidation.
      mediaType: { format: 'raw' },
      request: {
        fetch: taggedFetch([ALL_PAGES_TAG, pageTag(slug)]),
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      },
    });

    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    return null; // e.g. a directory that happens to be named "<slug>.md"
  } catch (error) {
    // GitHub also answers 404 for a missing branch, or a private repo the token can't read.
    if (error.status === 404) return null;
    throw toCMSError(error, filePath);
  }
}

/** Returns the slugs of the .md files in the content folder ([] if the folder doesn't exist). */
async function fetchSlugs(config) {
  let entries;
  try {
    ({ data: entries } = await getOctokit(config).rest.repos.getContent({
      owner: config.owner,
      repo: config.repo,
      path: config.contentDir,
      ref: config.branch,
      request: {
        fetch: taggedFetch([ALL_PAGES_TAG, PAGE_LIST_TAG]),
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      },
    }));
  } catch (error) {
    if (error.status === 404) return [];
    throw toCMSError(error, config.contentDir || '(repository root)');
  }

  if (!Array.isArray(entries)) return []; // GITHUB_CONTENT_DIR points at a file
  if (entries.length >= MAX_FOLDER_ENTRIES) {
    console.warn(
      `[github-cms] GitHub lists at most ${MAX_FOLDER_ENTRIES} files per folder, ` +
        'so some pages are missing from the page list.',
    );
  }
  return entries
    .filter((entry) => entry.type === 'file')
    .map((entry) => slugFromFilePath(entry.path, config.contentDir))
    .filter(Boolean);
}

function asText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  return String(value).trim() || null;
}

function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  // YAML turns unquoted `date: 2024-01-15` into a Date (UTC midnight) already.
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isPublished(value) {
  if (typeof value === 'string') return value.trim().toLowerCase() !== 'false';
  return value !== false; // pages are published unless marked `published: false`
}

function titleFromSlug(slug) {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * @typedef {object} PageSummary
 * @property {string} slug
 * @property {string} title
 * @property {string | null} description
 * @property {string | null} author
 * @property {Date | null} date
 *
 * @typedef {PageSummary & { html: string }} Page `html` is sanitized HTML from the Markdown body.
 */

/**
 * Fetches `<GITHUB_CONTENT_DIR>/<slug>.md` and parses its front-matter. Resolves to
 * null for invalid slugs and missing files. Cached per request, so a page, its
 * metadata and the page list share one lookup.
 */
const loadSource = cache(async (slug) => {
  if (!isValidSlug(slug)) return null;

  const config = getConfig();
  const filePath = filePathForSlug(slug, config.contentDir);
  const raw = await fetchMarkdown(slug, filePath, config);
  if (raw === null) return null;

  let parsed;
  try {
    parsed = matter(raw, GRAY_MATTER_OPTIONS);
  } catch (error) {
    throw new FrontMatterError(`Invalid front-matter in "${filePath}": ${error.message}`, {
      cause: error,
    });
  }

  const { data, content } = parsed;
  return {
    content,
    published: isPublished(data.published),
    /** @type {PageSummary} */
    summary: {
      slug,
      title: asText(data.title) ?? titleFromSlug(slug),
      description: asText(data.description),
      author: asText(data.author),
      date: parseDate(data.date),
    },
  };
});

/**
 * Loads a page and renders its Markdown body to sanitized HTML.
 *
 * Resolves to null when the slug is invalid, the file doesn't exist, or the page
 * has `published: false`; render a 404 in that case. Throws GitHubCMSError when
 * GitHub is unreachable or rejects the request, and its subclass FrontMatterError
 * when the front-matter can't be parsed.
 *
 * @param {string} slug
 * @returns {Promise<Page | null>}
 */
export const getPage = cache(async (slug) => {
  const source = await loadSource(slug);
  if (!source?.published) return null;
  return { ...source.summary, html: await renderMarkdown(source.content) };
});

/** Like `Promise.all(items.map(fn))`, but with at most `limit` calls in flight. */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Newest first; undated pages go last, alphabetically. */
function compareNewestFirst(a, b) {
  if (a.date && b.date) return b.date - a.date || a.title.localeCompare(b.title);
  if (a.date || b.date) return a.date ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/**
 * Summaries of every published page in the content folder, newest first.
 *
 * A file with invalid front-matter is left out with a warning instead of failing
 * the whole list, so one broken file can't take down the landing page or a
 * static build. GitHub failures still throw.
 *
 * @returns {Promise<PageSummary[]>}
 */
export const getPageList = cache(async () => {
  const slugs = await fetchSlugs(getConfig());

  const pages = await mapWithConcurrency(slugs, LIST_CONCURRENCY, async (slug) => {
    try {
      const source = await loadSource(slug);
      return source?.published ? source.summary : null;
    } catch (error) {
      if (!(error instanceof FrontMatterError)) throw error;
      console.warn(`[github-cms] Left out of the page list. ${error.message}`);
      return null;
    }
  });

  return pages.filter(Boolean).sort(compareNewestFirst);
});
