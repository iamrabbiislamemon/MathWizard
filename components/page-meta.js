// YAML dates are UTC midnight; format in UTC so they don't shift a day in other time zones.
const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' });

/** The "By <author> · <date>" line under a page title. Renders nothing if both are missing. */
export default function PageMeta({ author, date, className = '' }) {
  if (!author && !date) return null;

  return (
    <p
      className={`flex flex-wrap items-center gap-x-2 text-sm text-gray-500 dark:text-gray-400 ${className}`}
    >
      {author && (
        <span>
          By <span className="font-medium text-gray-900 dark:text-gray-100">{author}</span>
        </span>
      )}
      {author && date && <span aria-hidden="true">·</span>}
      {date && <time dateTime={date.toISOString().slice(0, 10)}>{dateFormatter.format(date)}</time>}
    </p>
  );
}
