import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { LanguageSwitch } from '../../../components/language-switch';
import {
  bookingCopy,
  bookingSlugPattern,
  publicBookingPageSchema,
} from '../../../lib/booking/public-booking';
import { publicCopy, resolvePublicLocale } from '../../../lib/i18n/public-copy';
import { createClient } from '../../../lib/supabase/server';
import { BookingFlow } from './booking-flow';
import './styles.css';

export const dynamic = 'force-dynamic';

async function loadPage(slug: string) {
  if (!bookingSlugPattern.test(slug)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_public_booking_page', {
    target_slug: slug,
  });
  if (error || !data) return null;
  const parsed = publicBookingPageSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>): Promise<Metadata> {
  const page = await loadPage((await params).slug.toLowerCase());
  if (!page) return { title: 'Online booking', robots: { index: false } };
  return {
    title: `Book online | ${page.business_name}`,
    description:
      page.intro ??
      `Book a visit with ${page.business_name}. Pick a service and an open time.`,
  };
}

export default async function PublicBookingPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}>) {
  const slug = (await params).slug.toLowerCase();
  const query = await searchParams;
  const locale = resolvePublicLocale(
    query.lang,
    (await headers()).get('accept-language'),
  );
  const page = await loadPage(slug);
  if (!page) notFound();
  const t = bookingCopy(locale);
  const common = publicCopy(locale).common;
  const place = [page.city, page.state_code].filter(Boolean).join(', ');

  return (
    <main className="public-booking-shell" lang={locale}>
      <section className="public-booking-card">
        <header className="public-booking-header">
          <div>
            <p className="public-booking-kicker">{t.bookOnline}</p>
            <h1>{page.headline ?? t.defaultHeadline(page.business_name)}</h1>
            <p className="public-booking-business">
              {page.business_name}
              {place ? ` · ${place}` : ''}
            </p>
            {page.intro ? (
              <p className="public-booking-intro">{page.intro}</p>
            ) : null}
          </div>
          <LanguageSwitch
            label={common.languageLabel}
            locale={locale}
            path={`/book/${page.slug}`}
          />
        </header>

        <BookingFlow locale={locale} page={page} />

        <footer className="public-booking-footer">
          {page.business_phone ? <p>{t.callUs(page.business_phone)}</p> : null}
          <p>{t.poweredBy}</p>
        </footer>
      </section>
    </main>
  );
}
