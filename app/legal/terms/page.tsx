import type { Metadata } from 'next';
import { LegalMarkdownPage } from '@/components/legal/LegalMarkdownPage';

export const metadata: Metadata = {
  title: 'Terms & Conditions — PrintSwift Local',
  description:
    'Terms & Conditions governing use of PrintSwift Local across Churachandpur.',
};

export default function TermsPage() {
  return <LegalMarkdownPage docKey="terms" />;
}
