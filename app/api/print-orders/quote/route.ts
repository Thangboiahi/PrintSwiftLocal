import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/payments/types';
import {
  calculatePrintQuote,
  PrintQuoteError,
} from '@/lib/print-orders/quote-engine';
import {
  authenticatePrintRequest,
  loadAndValidatePrintProfile,
  PrintApiError,
} from '@/lib/print-orders/server-helpers';
import type {
  PrintFileOptions,
  PrintHandoverMode,
  PrintOrderFile,
} from '@/lib/print-orders/types';

export async function POST(req: NextRequest) {
  try {
    const actor = await authenticatePrintRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required to calculate a print quote.' },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid JSON request body.' },
        { status: 400 }
      );
    }

    const orderId = String(body.orderId ?? body.order_id ?? '').trim();
    const requestedListingId = String(
      body.listingId ?? body.listing_id ?? ''
    ).trim();
    const rawHandover = String(
      body.handoverMode ?? body.handover_mode ?? 'walk_in_pickup'
    ).trim();
    const handoverMode: PrintHandoverMode =
      rawHandover === 'pick_n_drop' ? 'pick_n_drop' : 'walk_in_pickup';
    const sealedEnvelopeRequested = Boolean(
      body.sealedEnvelopeRequested ?? body.sealed_envelope_requested ?? false
    );

    if (!isUuid(orderId)) {
      return NextResponse.json(
        { error: 'Valid orderId (UUID) is required.' },
        { status: 400 }
      );
    }

    const { data: orderRow, error: orderErr } = await actor.supabaseAdmin
      .from('print_orders')
      .select(
        'id, listing_id, hub_id, customer_id, job_mode, fulfillment_status, files_purged_at'
      )
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !orderRow) {
      return NextResponse.json(
        { error: 'Print order not found.' },
        { status: 404 }
      );
    }

    if (String(orderRow.customer_id) !== actor.userId) {
      return NextResponse.json(
        { error: 'Forbidden: You do not own this print order.' },
        { status: 403 }
      );
    }

    const effectiveListingId = String(orderRow.listing_id);
    if (requestedListingId && requestedListingId !== effectiveListingId) {
      return NextResponse.json(
        { error: 'listingId does not match the target print order.' },
        { status: 400 }
      );
    }

    if (orderRow.files_purged_at !== null) {
      return NextResponse.json(
        { error: 'Files on this print order have already been purged.' },
        { status: 409 }
      );
    }

    const profile = await loadAndValidatePrintProfile(
      actor.supabaseAdmin,
      effectiveListingId
    );

    const { data: fileRows, error: filesErr } = await actor.supabaseAdmin
      .from('print_order_files')
      .select(
        'id, print_order_id, storage_object_key, display_label_masked, mime_type, file_size_bytes, server_verified_pages, print_options, purge_status, purged_at, created_at'
      )
      .eq('print_order_id', orderId)
      .eq('purge_status', 'active')
      .order('created_at', { ascending: true });

    if (filesErr) {
      return NextResponse.json(
        { error: `Failed to load uploaded print files: ${filesErr.message}` },
        { status: 500 }
      );
    }

    const activeFiles = (fileRows || []) as PrintOrderFile[];
    const fileOptionsInput = Array.isArray(body.fileOptions)
      ? (body.fileOptions as Array<
          { fileId?: string; file_id?: string; options?: PrintFileOptions } & PrintFileOptions
        >)
      : body.requestedOptions &&
          typeof body.requestedOptions === 'object' &&
          !Array.isArray(body.requestedOptions)
        ? (body.requestedOptions as PrintFileOptions)
        : undefined;

    const quoteResult = calculatePrintQuote({
      profile,
      files: activeFiles,
      requestedOptions: fileOptionsInput,
      handoverMode,
      sealedEnvelopeRequested,
      customerNoShowCount: actor.profile.print_no_show_count,
      jobMode:
        orderRow.job_mode === 'custom_digital'
          ? 'custom_digital'
          : 'instant_print',
    });

    // Persist normalized options back onto each file row for downstream shop visibility
    await Promise.all(
      quoteResult.quoteSnapshot.files.map((item) =>
        actor.supabaseAdmin
          .from('print_order_files')
          .update({ print_options: item.options })
          .eq('id', item.file_id)
      )
    );

    const { error: updateErr } = await actor.supabaseAdmin
      .from('print_orders')
      .update({
        quote_snapshot: quoteResult.quoteSnapshot,
        quoted_amount_inr: quoteResult.quoteSnapshot.total_amount_inr,
        platform_fee_inr: quoteResult.quoteSnapshot.platform_fee_inr,
        handover_mode: handoverMode,
        sealed_envelope_requested: sealedEnvelopeRequested,
        quote_status: 'quoted',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateErr) {
      return NextResponse.json(
        { error: `Failed to save print quote: ${updateErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      quoteSnapshot: quoteResult.quoteSnapshot,
      allowedPaymentRails: quoteResult.allowedPaymentRails,
      forcedEscrow: quoteResult.forcedEscrow,
      forcedEscrowReason: quoteResult.forcedEscrowReason,
      railReason: quoteResult.railReason,
    });
  } catch (err) {
    if (err instanceof PrintQuoteError || err instanceof PrintApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected error while calculating print quote.',
      },
      { status: 500 }
    );
  }
}
