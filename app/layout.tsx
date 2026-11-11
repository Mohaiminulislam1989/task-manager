import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Line Board', description: 'Production-line task board for multi-team work' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" suppressHydrationWarning>
    <head>
      {/* apply the saved theme before first paint, so there is no flash of the default theme */}
      <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('lb-look');if(t&&t!=='violet')document.documentElement.dataset.look=t}catch(e){}` }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
    </head>
    <body>{children}</body>
  </html>;
}
