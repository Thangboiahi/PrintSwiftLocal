import type { Metadata } from 'next';
import { LegalMarkdownPage } from '@/components/legal/LegalMarkdownPage';

export const metadata: Metadata = {
  title: 'Privacy Policy — DD oodle',
  description:
    'Privacy Policy and data handling commitments for DD oodle users.',
};

export default function PrivacyPolicyPage() {
  return <LegalMarkdownPage docKey="privacy" />;
}
