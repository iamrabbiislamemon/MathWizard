import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

// rehype-sanitize prefixes every `id`/`name` with this (as GitHub does) so that
// author content can't clobber globals like `window.someId` in the browser.
const CLOBBER_PREFIX = 'user-content-';

// The GitHub Pages build serves the site from /<repository> (see next.config.mjs).
const BASE_PATH = process.env.STATIC_EXPORT === 'true' ? process.env.PAGES_BASE_PATH || '' : '';

function rewriteHref(href) {
  // Same-page links (`#section`, footnote refs) must target the ids rehype-sanitize prefixed.
  if (href.startsWith('#')) {
    return href.length > 1 && !href.startsWith(`#${CLOBBER_PREFIX}`)
      ? `#${CLOBBER_PREFIX}${href.slice(1)}`
      : href;
  }
  // Links to other pages written as "/slug" need the site's path prefix.
  if (BASE_PATH && href.startsWith('/') && !href.startsWith('//')) {
    return `${BASE_PATH}${href}`;
  }
  return href;
}

function rehypeRewriteLinks() {
  const visit = (node) => {
    const href = node.properties?.href;
    if (node.tagName === 'a' && typeof href === 'string') {
      node.properties.href = rewriteHref(href);
    }
    node.children?.forEach(visit);
  };
  return visit;
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm) // tables, task lists, strikethrough, autolinks, footnotes
  // Keep inline HTML (<details>, <img>, …) so it's sanitized rather than dropped.
  // Footnote ids are left unprefixed here because rehype-sanitize adds the prefix.
  .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
  .use(rehypeRaw)
  .use(rehypeSlug) // heading anchors, like GitHub
  // GitHub's allow-list: removes <script>, <iframe>, inline styles, on* handlers,
  // javascript: URLs, etc. Anything added after this step must be trusted.
  .use(rehypeSanitize)
  .use(rehypeRewriteLinks)
  .use(rehypeStringify)
  .freeze();

/**
 * Converts a Markdown string into sanitized HTML that is safe to render with
 * `dangerouslySetInnerHTML`.
 *
 * @param {string} markdown
 * @returns {Promise<string>}
 */
export async function renderMarkdown(markdown) {
  return String(await processor.process(markdown));
}
