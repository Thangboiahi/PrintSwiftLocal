'use client';

import { compressPodImageToWebp } from '@/lib/media/pod-compressor';
import { mapDuplicateUtrError } from '@/lib/mediator/types';
import { isUuid } from '@/lib/payments/types';
import { supabase } from '@/lib/supabase/client';

/**
 * v21a (P0-13): single, canonical path for customers to submit a manual UPI UTR for a
 * Pick N Drop order. Replaces direct client writes to `delivery_transactions` /
 * `delivery_orders` (which left `payment_intents` stale and bypassed UTR replay guards).
 *
 * 1. Reuse the order's latest `awaiting_payment` intent, or mint a server-priced one via
 *    POST /api/payments/create-intent (purpose `pick_n_drop`).
 * 2. Upload the optional receipt (compressed WebP) to the PRIVATE `payment-proofs` bucket
 *    through POST /api/media/upload.
 * 3. POST /api/payments/submit-utr, which moves the intent to `pending_manual`, records the
 *    `delivery_transactions` row and advances the order to `payment_submitted`.
 */
export async function submitPickNDropUtr(params: {
  orderId: string;
  utr: string;
  proofFile?: File | null;
}): Promise<void> {
  const { orderId, utr, proofFile } = params;
  if (!isUuid(orderId)) {
    throw new Error('This order reference is invalid. Please refresh and try again.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new Error('Please sign in again to submit your payment proof.');
  }
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  // 1. Resolve the payment intent for this order. Only reuse an intent that is still
  //    inside its hold window (with a 60s safety margin) — /api/payments/submit-utr marks
  //    expired intents as `expired` and rejects them, so an old quote-bound intent must be
  //    replaced by a freshly minted one instead.
  let intentId: string | null = null;
  const reuseCutoffIso = new Date(Date.now() + 60_000).toISOString();
  const { data: existingIntent } = await supabase
    .from('payment_intents')
    .select('id, status, expires_at')
    .eq('purpose', 'pick_n_drop')
    .eq('reference_id', orderId)
    .eq('status', 'awaiting_payment')
    .or(`expires_at.is.null,expires_at.gt.${reuseCutoffIso}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingIntent?.id) {
    intentId = String(existingIntent.id);
  } else {
    const createRes = await fetch('/api/payments/create-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ purpose: 'pick_n_drop', referenceId: orderId }),
    });
    const createJson = (await createRes.json().catch(() => ({}))) as {
      intent?: { id?: string };
      error?: string;
    };
    if (!createRes.ok || !createJson.intent?.id) {
      throw new Error(
        createJson.error || 'Could not prepare the payment record for this order.'
      );
    }
    intentId = String(createJson.intent.id);
  }

  // 2. Private receipt upload (never public)
  let proofPath: string | null = null;
  if (proofFile) {
    const compressed = await compressPodImageToWebp(proofFile);
    const formData = new FormData();
    formData.append(
      'file',
      new File([compressed.blob], compressed.fileName, { type: compressed.mimeType })
    );
    formData.append('entityType', 'payment_utr_proof');
    formData.append('entityId', intentId);
    const uploadRes = await fetch('/api/media/upload', {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    });
    const uploadJson = (await uploadRes.json().catch(() => ({}))) as {
      success?: boolean;
      path?: string;
      error?: string;
    };
    if (!uploadRes.ok || !uploadJson.success || !uploadJson.path) {
      throw new Error(
        uploadJson.error || 'Could not upload your payment screenshot. Please try again.'
      );
    }
    proofPath = uploadJson.path;
  }

  // 3. Canonical UTR submission
  const submitRes = await fetch('/api/payments/submit-utr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      intentId,
      upiUtrRef: utr.trim().toUpperCase(),
      paymentProofPath: proofPath,
    }),
  });
  const submitJson = (await submitRes.json().catch(() => ({}))) as { error?: string };
  if (!submitRes.ok) {
    throw new Error(
      mapDuplicateUtrError(submitJson.error || 'Could not submit your UPI reference.')
    );
  }
}
