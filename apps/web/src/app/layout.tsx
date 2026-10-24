import type { Metadata } from 'next';

import { Shell } from '@/components/Shell';

import './globals.css';

export const metadata: Metadata = {
  title: 'Lulu Dashboard',
  description: "Alerts, sleep log and caregivers for your family's Lulu baby monitor. Built from event text only. No video is ever stored.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
