import type { MetadataRoute } from 'next';

// Lets phones "Add to Home Screen" so the dashboard opens like an app, with no app store or EAS build.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Lulu',
    short_name: 'Lulu',
    description: "Alerts, sleep log and caregivers for your family's Lulu baby monitor.",
    start_url: '/',
    display: 'standalone',
    background_color: '#f6efe7',
    theme_color: '#f6efe7',
    icons: [
      { src: '/icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
      { src: '/icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
