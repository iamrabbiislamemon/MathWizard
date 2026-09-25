/**
 * POST /api/revalidate: GitHub webhook that refreshes cached pages after a push.
 *
 * Configure it in GitHub under Repository → Settings → Webhooks → Add webhook:
 *
 *   Payload URL   https://<your-domain>/api/revalidate
 *                 GitHub must be able to reach it. For local testing, expose
 *                 localhost with a tunnel (e.g. `ngrok http 3000`) and use that URL.
 *   Content type  application/json. GitHub defaults to form-encoded, which this
 *                 endpoint rejects with 415.
 *   Secret        The exact value of WEBHOOK_SECRET, e.g. from `openssl rand -hex 32`.
 *   SSL           Leave "Enable SSL verification" on.
 *   Events        "Just the push event."
 *   Active        Checked.
 *
 * GitHub sends a `ping` right after the webhook is saved; a green check under
 * "Recent Deliveries" means the URL, content type and secret are right. The same
 * tab shows each push's response body (the revalidated slugs) and has a
 * "Redeliver" button if a delivery failed while the site was down.
 *
 * Instead of a repository webhook, the content repository's GitHub Actions workflow
 * can call this endpoint (content-repo/.github/workflows/publish-site.yml). Use one
 * or the other, not both. GitHub Pages builds don't include this endpoint.
 */
import { revalidateTag } from 'next/cache';
import { ALL_PAGES_TAG, PAGE_LIST_TAG, getConfig, pageTag } from '@/lib/github-cms';
import { getPagesChangedByPush, isValidSignature } from '@/lib/github-webhook';

// Expire immediately so the next visit renders the pushed content. Trade-off: if
// GitHub fails right then, that visit gets a 500 rather than the old page. Use "max"
// instead to keep serving the old page while it re-renders in the background.
const EXPIRE_NOW = { expire: 0 };

function json(body, status = 200) {
  return Response.json(body, { status });
}

export async function POST(request) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error('[revalidate] WEBHOOK_SECRET is not set; refusing all webhook requests.');
    return json({ error: 'Webhook secret is not configured on the server.' }, 500);
  }

  // Verify the signature against the raw bytes before trusting anything in the request.
  const body = Buffer.from(await request.arrayBuffer());
  if (!isValidSignature(body, request.headers.get('x-hub-signature-256'), secret)) {
    return json({ error: 'Invalid or missing X-Hub-Signature-256.' }, 401);
  }

  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return json({ error: 'Set the webhook content type to application/json.' }, 415);
  }

  const event = request.headers.get('x-github-event');
  if (event === 'ping') {
    return json({ ok: true, message: 'Webhook is configured correctly.' });
  }
  if (event !== 'push') {
    return json({ ok: true, message: `Ignored "${event}" event; only push events are handled.` });
  }

  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return json({ error: 'Request body is not valid JSON.' }, 400);
  }

  let config;
  try {
    config = getConfig();
  } catch (error) {
    console.error(`[revalidate] ${error.message}`);
    return json({ error: 'GitHub repository is not configured on the server.' }, 500);
  }

  // Only pushes to the repository and branch this site renders can change its pages.
  const repository = `${config.owner}/${config.repo}`;
  if (payload.repository?.full_name?.toLowerCase() !== repository.toLowerCase()) {
    const message = `Ignored push to another repository; this site reads ${repository}.`;
    return json({ ok: true, revalidated: [], message });
  }
  if (payload.ref !== `refs/heads/${config.branch}`) {
    const message = `Ignored push to ${payload.ref}; this site reads ${config.branch}.`;
    return json({ ok: true, revalidated: [], message });
  }

  const changes = getPagesChangedByPush(payload, config.contentDir);

  if (changes.all) {
    revalidateTag(ALL_PAGES_TAG, EXPIRE_NOW);
    console.log(`[revalidate] ${payload.after}: all pages (${changes.reason})`);
    return json({ ok: true, revalidated: 'all', reason: changes.reason });
  }

  for (const slug of changes.slugs) {
    revalidateTag(pageTag(slug), EXPIRE_NOW);
  }
  if (changes.slugs.length > 0) {
    // The landing page's list of files changes when pages are added or removed.
    revalidateTag(PAGE_LIST_TAG, EXPIRE_NOW);
    console.log(`[revalidate] ${payload.after}: ${changes.slugs.join(', ')}`);
  }
  return json({ ok: true, revalidated: changes.slugs });
}
