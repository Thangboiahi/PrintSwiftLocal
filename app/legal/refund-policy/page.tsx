import type { Metadata } from 'next';
import { LegalMarkdownPage } from '@/components/legal/LegalMarkdownPage';

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy — PrintSwift Local',
  description:
    'Refund, cancellation, and escrow dispute policy for PrintSwift Local payments.',
};

export default function RefundPolicyPage() {
  return <LegalMarkdownPage docKey="refund" />;
}
