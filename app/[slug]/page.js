import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPage, getPageList } from '@/lib/github-cms';
import PageMeta from '@/components/page-meta';

// Every published page is rendered at build time. On a server, a page added later is
// rendered on its first visit and every page stays cached until the webhook revalidates
// it; the static GitHub Pages build is simply redone after each push.
// Don't add a loading.js here: streaming would turn missing pages' 404s into 200s.
export async function generateStaticParams() {
  const pages = await getPageList();
  if (pages.length === 0 && process.env.STATIC_EXPORT === 'true') {
    throw new Error(
      'No published .md files were found, so there is nothing to export. Check GITHUB_OWNER, ' +
        'GITHUB_REPO, GITHUB_BRANCH and GITHUB_CONTENT_DIR.',
    );
  }
  return pages.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) return { title: 'Page not found' };
  return { title: page.title, description: page.description ?? undefined };
}

export default async function MarkdownPage({ params }) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) notFound();

  const { title, description, author, date, html } = page;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <Link
        href="/"
        className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        ← All articles
      </Link>

      <article className="mt-8">
        <header className="mb-10 border-b border-gray-200 pb-8 dark:border-gray-800">
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{title}</h1>
          {description && (
            <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">{description}</p>
          )}
          <PageMeta author={author} date={date} className="mt-6" />
        </header>

        {/* `html` was sanitized in lib/markdown.js, so it is safe to inject. */}
        <div
          className="prose prose-gray max-w-none wrap-break-word dark:prose-invert lg:prose-lg prose-code:before:content-none prose-code:after:content-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </article>
    </main>
  );
}
