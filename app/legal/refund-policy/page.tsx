import type { Metadata } from 'next';
import { LegalMarkdownPage } from '@/components/legal/LegalMarkdownPage';

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy — DD oodle',
  description:
    'Refund, cancellation, and escrow dispute policy for DD oodle payments.',
};

export default function RefundPolicyPage() {
  return <LegalMarkdownPage docKey="refund" />;
}
