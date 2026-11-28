import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/payments/types';
import { validateAndInspectPrintFile } from '@/lib/print-orders/pdf-validator';
import {
  authenticatePrintRequest,
  generatePrintOrderCode,
  loadAndValidatePrintProfile,
  PrintApiError,
} from '@/lib/print-orders/server-helpers';
import {
  PRINT_DOCUMENTS_BUCKET,
  type PrintFileOptions,
  type PrintJobMode,
} from '@/lib/print-orders/types';

function parseOptionalJsonOptions(raw: FormDataEntryValue | null): PrintFileOptions {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as PrintFileOptions;
    }
  } catch {
    // Ignore invalid optional JSON; validated strictly during quoting
  }
  return {};
}

export async function POST(req: NextRequest) {
  try {
    const actor = await authenticatePrintRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required to upload print documents.' },
        { status: 401 }
      );
    }

    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json(
        { error: 'Expected multipart/form-data payload with file and listingId.' },
        { status: 400 }
      );
    }

    const fileEntry = formData.get('file');
    const listingId = String(
      formData.get('listingId') ?? formData.get('listing_id') ?? ''
    ).trim();
    const requestedOrderId = String(
      formData.get('orderId') ?? formData.get('order_id') ?? ''
    ).trim();
    const rawJobMode = String(
      formData.get('jobMode') ?? formData.get('job_mode') ?? 'instant_print'
    ).trim();
    const jobMode: PrintJobMode =
      rawJobMode === 'custom_digital' ? 'custom_digital' : 'instant_print';
    const printOptions = parseOptionalJsonOptions(
      formData.get('printOptions') ?? formData.get('print_options')
    );

    if (!isUuid(listingId)) {
      return NextResponse.json(
        { error: 'Valid listingId (UUID) is required.' },
        { status: 400 }
      );
    }

    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { error: 'A document file (PDF, JPEG, PNG, or WebP) is required.' },
        { status: 400 }
      );
    }

    // Load print profile, enforce hub kill-switch + active Print Pro entitlement
    // If creating a new draft order, also enforce is_accepting_orders & busy_until gate
    const profile = await loadAndValidatePrintProfile(
      actor.supabaseAdmin,
      listingId,
      { requireAcceptingOrders: !requestedOrderId }
    );

    const arrayBuffer = await fileEntry.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const maxBytesForShop = Math.min(
      25 * 1024 * 1024,
      Math.max(1, Number(profile.max_file_size_mb || 25)) * 1024 * 1024
    );
    if (bytes.byteLength > maxBytesForShop) {
      return NextResponse.json(
        {
          error: `File exceeds this shop's ${profile.max_file_size_mb || 25} MB per-file upload limit.`,
          code: 'FILE_TOO_LARGE',
        },
        { status: 400 }
      );
    }

    const validation = validateAndInspectPrintFile(bytes, fileEntry.type);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error, code: validation.code },
        { status: 400 }
      );
    }

    let effectiveOrderId = requestedOrderId;
    let createdNewDraft = false;

    if (effectiveOrderId) {
      if (!isUuid(effectiveOrderId)) {
        return NextResponse.json(
          { error: 'orderId must be a valid UUID when provided.' },
          { status: 400 }
        );
      }

      const { data: existingOrder, error: existingOrderErr } =
        await actor.supabaseAdmin
          .from('print_orders')
          .select('id, listing_id, customer_id, hub_id, fulfillment_status, files_purged_at')
          .eq('id', effectiveOrderId)
          .maybeSingle();

      if (existingOrderErr || !existingOrder) {
        return NextResponse.json(
          { error: 'Target print order was not found.' },
          { status: 404 }
        );
      }

      if (String(existingOrder.customer_id) !== actor.userId) {
        return NextResponse.json(
          { error: 'Forbidden: You do not own this print order.' },
          { status: 403 }
        );
      }

      if (String(existingOrder.listing_id) !== listingId) {
        return NextResponse.json(
          { error: 'Order does not belong to the specified print shop listing.' },
          { status: 400 }
        );
      }

      if (
        !['draft', 'confirmed'].includes(String(existingOrder.fulfillment_status)) ||
        existingOrder.files_purged_at !== null
      ) {
        return NextResponse.json(
          { error: 'Cannot attach new files to a finalized or purged print order.' },
          { status: 409 }
        );
      }
    } else {
      const orderCode = generatePrintOrderCode();
      const { data: draftOrder, error: draftErr } = await actor.supabaseAdmin
        .from('print_orders')
        .insert({
          order_code: orderCode,
          hub_id: profile.hub_id,
          listing_id: profile.listing_id,
          customer_id: actor.userId,
          is_first_party_order: profile.is_first_party_printswift,
          job_mode: jobMode,
          quote_status: 'unquoted',
          payment_status: 'not_required_yet',
          fulfillment_status: 'draft',
          settlement_status: 'not_applicable',
          purge_status: 'active',
        })
        .select('id')
        .single();

      if (draftErr || !draftOrder?.id) {
        return NextResponse.json(
          {
            error:
              draftErr?.message || 'Failed to create draft print order.',
          },
          { status: 500 }
        );
      }

      effectiveOrderId = String(draftOrder.id);
      createdNewDraft = true;
    }

    // Count existing files on this order to generate a non-PII masked label
    const { count: existingFileCount } = await actor.supabaseAdmin
      .from('print_order_files')
      .select('id', { count: 'exact', head: true })
      .eq('print_order_id', effectiveOrderId);

    const docIndex = (existingFileCount ?? 0) + 1;
    const displayLabelMasked = `Document ${docIndex} (${validation.pageCount} pages)`;
    const storageObjectKey = `${profile.hub_id}/${effectiveOrderId}/${randomUUID()}.${validation.extension}`;

    const { error: uploadError } = await actor.supabaseAdmin.storage
      .from(PRINT_DOCUMENTS_BUCKET)
      .upload(storageObjectKey, bytes, {
        contentType: validation.mimeType,
        upsert: false,
      });

    if (uploadError) {
      if (createdNewDraft) {
        await actor.supabaseAdmin
          .from('print_orders')
          .delete()
          .eq('id', effectiveOrderId);
      }
      return NextResponse.json(
        {
          error: `Failed to store document in private vault: ${uploadError.message}`,
        },
        { status: 500 }
      );
    }

    const { data: fileRecord, error: fileInsertErr } = await actor.supabaseAdmin
      .from('print_order_files')
      .insert({
        print_order_id: effectiveOrderId,
        storage_object_key: storageObjectKey,
        display_label_masked: displayLabelMasked,
        mime_type: validation.mimeType,
        file_size_bytes: validation.byteSize,
        server_verified_pages: validation.pageCount,
        print_options: printOptions,
        purge_status: 'active',
      })
      .select('*')
      .single();

    if (fileInsertErr || !fileRecord) {
      await actor.supabaseAdmin.storage
        .from(PRINT_DOCUMENTS_BUCKET)
        .remove([storageObjectKey]);
      if (createdNewDraft) {
        await actor.supabaseAdmin
          .from('print_orders')
          .delete()
          .eq('id', effectiveOrderId);
      }
      return NextResponse.json(
        {
          error:
            fileInsertErr?.message ||
            'Failed to register uploaded print file record.',
        },
        { status: 500 }
      );
    }

    await actor.supabaseAdmin.from('print_order_events').insert({
      print_order_id: effectiveOrderId,
      actor_id: actor.userId,
      actor_role: actor.actualRole,
      event_type: 'file_uploaded',
      metadata: {
        file_id: fileRecord.id,
        display_label_masked: displayLabelMasked,
        mime_type: validation.mimeType,
        file_size_bytes: validation.byteSize,
        server_verified_pages: validation.pageCount,
      },
    });

    const { data: signedPreviewData } = await actor.supabaseAdmin.storage
      .from(PRINT_DOCUMENTS_BUCKET)
      .createSignedUrl(storageObjectKey, 3600);

    return NextResponse.json(
      {
        orderId: effectiveOrderId,
        fileRecord,
        previewUrl: signedPreviewData?.signedUrl ?? null,
      },
      { status: 201 }
    );
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
            : 'Unexpected error while uploading print document.',
      },
      { status: 500 }
    );
  }
}
