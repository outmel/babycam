import type { Metadata, Viewport } from 'next';

import { Shell } from '@/components/Shell';

import './globals.css';

export const metadata: Metadata = {
  title: 'Lulu Dashboard',
  icons: { icon: '/icon.png', apple: '/icon.png' },
  appleWebApp: { capable: true, title: 'Lulu' },
  description: "Alerts, sleep log and caregivers for your family's Lulu baby monitor. Built from event text only. No video is ever stored.",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f6efe7',
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
