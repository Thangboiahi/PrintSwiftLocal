import type { Metadata } from 'next';
import { LegalMarkdownPage } from '@/components/legal/LegalMarkdownPage';

export const metadata: Metadata = {
  title: 'Terms & Conditions — DD oodle',
  description:
    'Terms & Conditions governing use of DD oodle across Churachandpur.',
};

export default function TermsPage() {
  return <LegalMarkdownPage docKey="terms" />;
}
