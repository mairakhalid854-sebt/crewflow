import Link from 'next/link';

import type { PublicLocale } from '../lib/i18n/public-copy';

/** Small English / Español switch for public customer pages. */
export function LanguageSwitch({
  label,
  locale,
  path,
}: Readonly<{ label: string; locale: PublicLocale; path: string }>) {
  return (
    <nav aria-label={label} className="public-language-switch">
      <Link
        aria-current={locale === 'en' ? 'true' : undefined}
        href={`${path}?lang=en`}
        hrefLang="en"
        lang="en"
      >
        English
      </Link>
      <Link
        aria-current={locale === 'es' ? 'true' : undefined}
        href={`${path}?lang=es`}
        hrefLang="es"
        lang="es"
      >
        Español
      </Link>
    </nav>
  );
}
