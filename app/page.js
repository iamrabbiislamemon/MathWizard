import Link from 'next/link';
import { getPageList } from '@/lib/github-cms';
import PageMeta from '@/components/page-meta';

// The landing page's heading, browser title and search-result description.
const SITE_NAME = 'MathWizard';
const SITE_DESCRIPTION = 'Articles and guides.';

export const metadata = { title: SITE_NAME, description: SITE_DESCRIPTION };

// Lists every published page. Like the pages themselves, it's cached: on a server the
// webhook refreshes it after each push, and the GitHub Pages build regenerates it.
export default async function HomePage() {
  const pages = await getPageList();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-4 border-b border-gray-200 pb-8 dark:border-gray-800">
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{SITE_NAME}</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">{SITE_DESCRIPTION}</p>
      </header>

      {pages.length === 0 ? (
        <p className="py-6 text-gray-600 dark:text-gray-400">Nothing has been published yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {pages.map(({ slug, title, description, author, date }) => (
            <li key={slug}>
              <article className="py-6">
                <h2 className="text-xl font-semibold tracking-tight text-balance">
                  <Link href={`/${slug}`} className="hover:underline">
                    {title}
                  </Link>
                </h2>
                {description && (
                  <p className="mt-2 text-gray-600 dark:text-gray-400">{description}</p>
                )}
                <PageMeta author={author} date={date} className="mt-3" />
              </article>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
