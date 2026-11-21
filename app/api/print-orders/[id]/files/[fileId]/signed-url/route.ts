import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/payments/types';
import {
  authenticatePrintRequest,
  loadAndValidatePrintProfile,
  PrintApiError,
  verifyIsPrintOperatorForListing,
} from '@/lib/print-orders/server-helpers';
import { PRINT_DOCUMENTS_BUCKET } from '@/lib/print-orders/types';

const SIGNED_URL_TTL_SECONDS = 300; // Strictly 5 minutes

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const actor = await authenticatePrintRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required to access print documents.' },
        { status: 401 }
      );
    }

    const { id: orderId, fileId } = await context.params;
    if (!isUuid(orderId) || !isUuid(fileId)) {
      return NextResponse.json(
        { error: 'Valid orderId and fileId (UUIDs) are required.' },
        { status: 400 }
      );
    }

    const { data: orderRow, error: orderErr } = await actor.supabaseAdmin
      .from('print_orders')
      .select(
        'id, hub_id, listing_id, customer_id, fulfillment_status, files_purged_at, purge_status'
      )
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !orderRow) {
      return NextResponse.json(
        { error: 'Print order not found.' },
        { status: 404 }
      );
    }

    const listingId = String(orderRow.listing_id);

    // Enforce hub kill-switch + active Print Pro entitlement
    await loadAndValidatePrintProfile(actor.supabaseAdmin, listingId);

    const isCustomer = String(orderRow.customer_id) === actor.userId;
    const isOperator = isCustomer
      ? false
      : await verifyIsPrintOperatorForListing({
          supabaseAdmin: actor.supabaseAdmin,
          userToken: actor.userToken,
          userId: actor.userId,
          actualRole: actor.actualRole,
          listingId,
        });

    // Strict Least-Privilege Privacy Barrier:
    // Explicitly rejects Hub Managers and general directory moderators on third-party orders.
    if (!isCustomer && !isOperator) {
      return NextResponse.json(
        {
          error:
            'Forbidden: Only the order customer or authorized shop print operator may access print documents. Hub Managers and directory moderators do not have file access.',
          code: 'PRINT_FILE_PRIVACY_FORBIDDEN',
        },
        { status: 403 }
      );
    }

    if (orderRow.files_purged_at !== null || orderRow.purge_status === 'purged') {
      return NextResponse.json(
        {
          error:
            'Documents for this order have been permanently purged in accordance with our 48-hour privacy policy.',
          code: 'FILES_PURGED',
        },
        { status: 410 }
      );
    }

    const fulfillmentStatus = String(orderRow.fulfillment_status);
    if (
      !isCustomer &&
      isOperator &&
      !['confirmed', 'printing', 'ready_for_pickup'].includes(fulfillmentStatus)
    ) {
      return NextResponse.json(
        {
          error: `Shop operators may only download files while an order is active (confirmed, printing, or ready_for_pickup). Current status: "${fulfillmentStatus}".`,
          code: 'OPERATOR_ACCESS_WINDOW_CLOSED',
        },
        { status: 403 }
      );
    }

    const { data: fileRow, error: fileErr } = await actor.supabaseAdmin
      .from('print_order_files')
      .select(
        'id, print_order_id, storage_object_key, display_label_masked, mime_type, purge_status, purged_at'
      )
      .eq('id', fileId)
      .eq('print_order_id', orderId)
      .maybeSingle();

    if (fileErr || !fileRow) {
      return NextResponse.json(
        { error: 'Print file not found on this order.' },
        { status: 404 }
      );
    }

    if (fileRow.purge_status === 'purged' || fileRow.purged_at !== null) {
      return NextResponse.json(
        {
          error: 'This document has already been permanently purged.',
          code: 'FILE_PURGED',
        },
        { status: 410 }
      );
    }

    const storageKey = String(fileRow.storage_object_key || '').replace(
      /^\/+/,
      ''
    );
    const { data: signedData, error: signedErr } =
      await actor.supabaseAdmin.storage
        .from(PRINT_DOCUMENTS_BUCKET)
        .createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);

    if (signedErr || !signedData?.signedUrl) {
      return NextResponse.json(
        {
          error:
            signedErr?.message ||
            'Failed to generate temporary signed URL for print document.',
        },
        { status: 500 }
      );
    }

    await actor.supabaseAdmin.from('print_order_events').insert({
      print_order_id: orderId,
      actor_id: actor.userId,
      actor_role: isCustomer ? 'customer' : actor.actualRole,
      event_type: 'file_signed_url_issued',
      metadata: {
        file_id: fileRow.id,
        display_label_masked: fileRow.display_label_masked,
        access_type: isCustomer ? 'customer' : 'shop_operator',
        expires_in_seconds: SIGNED_URL_TTL_SECONDS,
      },
    });

    return NextResponse.json({
      signedUrl: signedData.signedUrl,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      fileId: fileRow.id,
      displayLabel: fileRow.display_label_masked,
      mimeType: fileRow.mime_type,
    });
  } catch (err) {
    if (err instanceof PrintApiError) {
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
            : 'Unexpected error while issuing signed print document URL.',
      },
      { status: 500 }
    );
  }
}
