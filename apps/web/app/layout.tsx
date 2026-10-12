import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@crewflow/ui/tokens.css';
import './styles.css';

export const metadata: Metadata = {
  description: 'Field service operations, clearly in motion.',
  title: 'CrewFlow',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
