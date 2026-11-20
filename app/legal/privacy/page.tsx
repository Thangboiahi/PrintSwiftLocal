import type { Metadata } from 'next';
import { LegalMarkdownPage } from '@/components/legal/LegalMarkdownPage';

export const metadata: Metadata = {
  title: 'Privacy Policy — PrintSwift Local',
  description:
    'Privacy Policy and data handling commitments for PrintSwift Local users.',
};

export default function PrivacyPolicyPage() {
  return <LegalMarkdownPage docKey="privacy" />;
}
