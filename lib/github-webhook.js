import { createHmac, timingSafeEqual } from 'node:crypto';
import { slugFromFilePath } from './github-cms';

// GitHub caps a push payload's `commits` array at 2048 entries.
const MAX_PAYLOAD_COMMITS = 2048;

/**
 * Checks GitHub's `X-Hub-Signature-256` header, an HMAC-SHA256 of the raw request
 * body keyed with the webhook secret.
 * https://docs.github.com/webhooks/using-webhooks/validating-webhook-deliveries
 *
 * @param {Buffer} body Raw request body, exactly as received.
 * @param {string | null} signatureHeader
 * @param {string} secret
 */
export function isValidSignature(body, signatureHeader, secret) {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const received = Buffer.from(signatureHeader);
  // Constant-time comparison so response timing can't reveal the expected digest.
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Works out which pages a `push` payload affects.
 *
 * Added, modified *and* removed files are included so deleted pages start
 * returning 404 (a rename appears as removed + added). When the commit list
 * can't be trusted to name every changed file, every page is revalidated.
 *
 * @param {object} payload Parsed `push` event payload.
 * @param {string} contentDir See getConfig().contentDir.
 * @returns {{ all: true, reason: string } | { all: false, slugs: string[] }}
 */
export function getPagesChangedByPush(payload, contentDir) {
  const commits = Array.isArray(payload.commits) ? payload.commits : [];

  // A force push can move the branch back to older content without listing those
  // files in any commit, and a deleted or recreated branch changes everything.
  if (payload.forced) return { all: true, reason: 'force push' };
  if (payload.created || payload.deleted) return { all: true, reason: 'branch created or deleted' };
  if (commits.length >= MAX_PAYLOAD_COMMITS) return { all: true, reason: 'commit list truncated' };

  const slugs = new Set();
  for (const { added = [], modified = [], removed = [] } of commits) {
    for (const filePath of [...added, ...modified, ...removed]) {
      const slug = slugFromFilePath(filePath, contentDir);
      if (slug) slugs.add(slug);
    }
  }
  return { all: false, slugs: [...slugs].sort() };
}
