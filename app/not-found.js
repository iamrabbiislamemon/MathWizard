import Link from 'next/link';

// Rendered for unknown URLs and whenever a page calls notFound(), e.g. when the
// Markdown file doesn't exist on GitHub or has `published: false`. The static
// GitHub Pages build turns it into 404.html.
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-24 text-center sm:px-6">
      <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Page not found</h1>
      <p className="mt-4 text-gray-600 dark:text-gray-400">
        There&apos;s no page at this address. It may have been moved, renamed or unpublished.
      </p>
      <Link
        href="/"
        className="mt-8 inline-block text-sm font-semibold text-gray-900 hover:underline dark:text-gray-100"
      >
        See all articles
      </Link>
    </main>
  );
}
