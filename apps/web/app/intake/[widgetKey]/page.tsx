import type { Metadata } from 'next';

import { IntakeChat } from './intake-chat';

export const metadata: Metadata = {
  description: 'Request service from a CrewFlow business.',
  robots: { follow: false, index: false },
  title: 'Request service | CrewFlow',
};

type IntakePageProps = {
  params: Promise<{ widgetKey: string }>;
};

export default async function IntakePage({ params }: IntakePageProps) {
  const { widgetKey } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  return (
    <main>
      <IntakeChat
        endpoint={
          supabaseUrl ? `${supabaseUrl}/functions/v1/public-intake` : undefined
        }
        widgetKey={widgetKey}
      />
    </main>
  );
}
