import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Akwaaba Market — Good things from Ghana',
  description: 'Shop verified Ghanaian finds from a privacy-first marketplace.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
