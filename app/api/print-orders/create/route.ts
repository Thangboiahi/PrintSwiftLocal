import { NextRequest, NextResponse } from 'next/server';
import { fetchServerPaymentConfig } from '@/lib/config/server';
import {
  buildPlatformUpiDetails,
  isUuid,
  type PaymentIntentRecord,
  type PaymentPurpose,
} from '@/lib/payments/types';
import {
  calculatePrintQuote,
  PrintQuoteError,
} from '@/lib/print-orders/quote-engine';
import {
  authenticatePrintRequest,
  buildShopDirectUpiDetails,
  generateCollectionOtp,
  generatePaymentIntentCode,
  generatePrintOrderCode,
  loadAndValidatePrintProfile,
  PrintApiError,
} from '@/lib/print-orders/server-helpers';
import type {
  PrintFileOptions,
  PrintHandoverMode,
  PrintJobMode,
  PrintOrderFile,
  PrintPaymentRail,
} from '@/lib/print-orders/types';

function isValidPaymentRail(val: unknown): val is PrintPaymentRail {
  return (
    val === 'direct_counter' ||
    val === 'direct_shop_upi' ||
    val === 'platform_escrow'
  );
}

export async function POST(req: NextRequest) {
  try {
    const actor = await authenticatePrintRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required to submit a print order.' },
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

    const requestedOrderId = String(body.orderId ?? body.order_id ?? '').trim();
    const requestedListingId = String(
      body.listingId ?? body.listing_id ?? ''
    ).trim();
    const rawJobMode = String(
      body.jobMode ?? body.job_mode ?? 'instant_print'
    ).trim();
    const jobMode: PrintJobMode =
      rawJobMode === 'custom_digital' ? 'custom_digital' : 'instant_print';

    const rawHandover = String(
      body.handoverMode ?? body.handover_mode ?? 'walk_in_pickup'
    ).trim();
    const handoverMode: PrintHandoverMode =
      rawHandover === 'pick_n_drop' ? 'pick_n_drop' : 'walk_in_pickup';

    const sealedEnvelopeRequested = Boolean(
      body.sealedEnvelopeRequested ?? body.sealed_envelope_requested ?? false
    );
    const serviceCategorySlug =
      String(
        body.serviceCategorySlug ?? body.service_category_slug ?? ''
      ).trim() || null;
    const customerInstructions =
      String(
        body.customerInstructions ?? body.customer_instructions ?? ''
      ).trim() || null;
    const provider =
      body.provider === 'razorpay' ? 'razorpay' : ('manual_upi' as const);

    // Resolve existing draft order if orderId provided
    let existingOrder: Record<string, unknown> | null = null;
    if (requestedOrderId) {
      if (!isUuid(requestedOrderId)) {
        return NextResponse.json(
          { error: 'orderId must be a valid UUID.' },
          { status: 400 }
        );
      }

      const { data: orderData, error: orderFetchErr } =
        await actor.supabaseAdmin
          .from('print_orders')
          .select('*')
          .eq('id', requestedOrderId)
          .maybeSingle();

      if (orderFetchErr || !orderData) {
        return NextResponse.json(
          { error: 'Draft print order not found.' },
          { status: 404 }
        );
      }

      if (String(orderData.customer_id) !== actor.userId) {
        return NextResponse.json(
          { error: 'Forbidden: You do not own this print order.' },
          { status: 403 }
        );
      }

      if (String(orderData.fulfillment_status) !== 'draft') {
        return NextResponse.json(
          {
            error: `Print order is already in "${orderData.fulfillment_status}" state and cannot be resubmitted.`,
          },
          { status: 409 }
        );
      }

      existingOrder = orderData as Record<string, unknown>;
    }

    const effectiveListingId =
      requestedListingId ||
      (existingOrder?.listing_id ? String(existingOrder.listing_id) : '');

    if (!isUuid(effectiveListingId)) {
      return NextResponse.json(
        { error: 'Valid listingId (UUID) is required.' },
        { status: 400 }
      );
    }

    if (
      existingOrder &&
      String(existingOrder.listing_id) !== effectiveListingId
    ) {
      return NextResponse.json(
        { error: 'orderId does not belong to the specified listingId.' },
        { status: 400 }
      );
    }

    // Enforce hub kill-switch, Print Pro entitlement, is_accepting_orders & busy_until
    const profile = await loadAndValidatePrintProfile(
      actor.supabaseAdmin,
      effectiveListingId,
      { requireAcceptingOrders: true }
    );

    // Honest first-party Official PrintSwift checkout gate (accepting orders + phone OTP verification)
    if (profile.is_first_party_printswift) {
      if (!actor.profile.phone_verified_at) {
        return NextResponse.json(
          {
            error:
              'Phone OTP verification is required before placing an Official DD oodle Print order. Please verify your phone number first.',
            code: 'PHONE_OTP_REQUIRED',
          },
          { status: 403 }
        );
      }
    }

    const { otp: collectionOtp, hash: collectionOtpHash } =
      generateCollectionOtp();
    const nowIso = new Date().toISOString();

    // =========================================================================
    // MODE B QUOTE ACCEPTANCE: Customer accepts shop's custom quote
    // =========================================================================
    const acceptCustomQuote = body.acceptCustomQuote === true;
    if (
      acceptCustomQuote &&
      existingOrder &&
      String(existingOrder.job_mode) === 'custom_digital' &&
      String(existingOrder.quote_status) === 'quoted'
    ) {
      const quotedInr = Math.round(Number(existingOrder.quoted_amount_inr || 0) * 100) / 100;
      if (quotedInr <= 0) {
        return NextResponse.json(
          { error: 'Shop quote amount must be greater than ₹0 before acceptance.' },
          { status: 400 }
        );
      }

      const existingSnapshot = (existingOrder.quote_snapshot || {}) as Record<
        string,
        unknown
      >;
      const forcedEscrow = Boolean(existingSnapshot.forced_escrow);
      const allowedRails = Array.isArray(existingSnapshot.allowed_payment_rails)
        ? (existingSnapshot.allowed_payment_rails as PrintPaymentRail[])
        : ['platform_escrow' as PrintPaymentRail];

      const requestedRailRaw = body.paymentRail ?? body.payment_rail;
      const chosenRail: PrintPaymentRail = forcedEscrow
        ? 'platform_escrow'
        : isValidPaymentRail(requestedRailRaw) &&
            allowedRails.includes(requestedRailRaw)
          ? requestedRailRaw
          : allowedRails[0] || 'platform_escrow';

      const orderId = String(existingOrder.id);
      const existingOtp = existingOrder.collection_otp_display_for_customer
        ? String(existingOrder.collection_otp_display_for_customer)
        : collectionOtp;
      const existingOtpHash = existingOrder.collection_otp_hash
        ? String(existingOrder.collection_otp_hash)
        : collectionOtpHash;

      if (chosenRail === 'platform_escrow') {
        const paymentPurpose: PaymentPurpose =
          existingOrder.handover_mode === 'pick_n_drop'
            ? 'print_order_with_delivery'
            : 'print_order';

        const expiresAtIso = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const { data: intentRow, error: intentErr } = await actor.supabaseAdmin
          .from('payment_intents')
          .insert({
            intent_code: generatePaymentIntentCode(),
            user_id: actor.userId,
            hub_id: profile.hub_id,
            purpose: paymentPurpose,
            reference_id: orderId,
            print_order_id: orderId,
            amount_inr: quotedInr,
            base_amount_inr: quotedInr,
            provider,
            status: 'awaiting_payment',
            expires_at: expiresAtIso,
          })
          .select('*')
          .single();

        if (intentErr || !intentRow) {
          return NextResponse.json(
            {
              error:
                intentErr?.message ||
                'Failed to create escrow payment intent for custom quote.',
            },
            { status: 500 }
          );
        }

        const { data: updatedOrder } = await actor.supabaseAdmin
          .from('print_orders')
          .update({
            payment_rail: 'platform_escrow',
            payment_intent_id: intentRow.id,
            collection_otp_hash: existingOtpHash,
            collection_otp_display_for_customer: existingOtp,
            payment_status: 'unpaid',
            settlement_status: profile.is_first_party_printswift
              ? 'not_applicable'
              : 'locked',
            updated_at: nowIso,
          })
          .eq('id', orderId)
          .select('*')
          .single();

        const paymentConfig = await fetchServerPaymentConfig(
          actor.supabaseAdmin,
          profile.hub_id
        );
        const upiDetails = buildPlatformUpiDetails({
          intentCode: String(intentRow.intent_code),
          amountInr: quotedInr,
          purpose: paymentPurpose,
          upiIdOverride: paymentConfig.upi_id,
          upiPayeeNameOverride: paymentConfig.upi_payee_name,
        });

        return NextResponse.json(
          {
            order: updatedOrder || existingOrder,
            paymentIntent: intentRow,
            upiDetails,
            collectionOtp: existingOtp,
          },
          { status: 200 }
        );
      }

      const { data: confirmedOrder, error: confirmErr } =
        await actor.supabaseAdmin
          .from('print_orders')
          .update({
            payment_rail: chosenRail,
            quote_status: 'accepted',
            payment_status: 'unpaid',
            fulfillment_status: 'confirmed',
            settlement_status: 'not_applicable',
            collection_otp_hash: existingOtpHash,
            collection_otp_display_for_customer: existingOtp,
            updated_at: nowIso,
          })
          .eq('id', orderId)
          .select('*')
          .single();

      if (confirmErr || !confirmedOrder) {
        return NextResponse.json(
          {
            error:
              confirmErr?.message || 'Failed to confirm custom digital quote.',
          },
          { status: 500 }
        );
      }

      await actor.supabaseAdmin.from('print_order_events').insert({
        print_order_id: orderId,
        actor_id: actor.userId,
        actor_role: actor.actualRole,
        event_type: 'custom_quote_accepted',
        metadata: {
          payment_rail: chosenRail,
          quoted_amount_inr: quotedInr,
        },
      });

      const shopUpi =
        chosenRail === 'direct_shop_upi'
          ? buildShopDirectUpiDetails({
              shopUpiId: profile.payment_policy.shop_upi_id,
              shopUpiName: profile.payment_policy.shop_upi_name,
              orderCode: String(confirmedOrder.order_code || ''),
              amountInr: quotedInr,
              verified: profile.payment_policy.shop_upi_verified,
            })
          : null;

      return NextResponse.json(
        {
          order: confirmedOrder,
          collectionOtp: existingOtp,
          shopUpi,
        },
        { status: 200 }
      );
    }

    // =========================================================================
    // MODE B: Custom Digital & Design Job (`awaiting_shop_quote`)
    // =========================================================================
    if (jobMode === 'custom_digital') {
      if (
        !profile.capabilities.custom_digital_jobs ||
        profile.verified_capabilities.custom_digital_jobs === false
      ) {
        return NextResponse.json(
          {
            error:
              'This shop does not currently accept Custom Digital & Design quote requests.',
            code: 'CAPABILITY_UNSUPPORTED',
          },
          { status: 400 }
        );
      }

      if (!customerInstructions || customerInstructions.length < 5) {
        return NextResponse.json(
          {
            error:
              'Please provide clear job instructions (at least 5 characters) for your Custom Digital request.',
          },
          { status: 400 }
        );
      }

      let savedOrder: Record<string, unknown>;

      if (existingOrder) {
        const { data: updated, error: updateErr } = await actor.supabaseAdmin
          .from('print_orders')
          .update({
            job_mode: 'custom_digital',
            service_category_slug: serviceCategorySlug,
            customer_instructions: customerInstructions,
            handover_mode: handoverMode,
            sealed_envelope_requested: sealedEnvelopeRequested,
            phone_otp_verified_at: actor.profile.phone_verified_at,
            collection_otp_hash: collectionOtpHash,
            collection_otp_display_for_customer: collectionOtp,
            quote_status: 'awaiting_shop_quote',
            payment_status: 'not_required_yet',
            fulfillment_status: 'draft',
            settlement_status: 'not_applicable',
            updated_at: nowIso,
          })
          .eq('id', String(existingOrder.id))
          .select('*')
          .single();

        if (updateErr || !updated) {
          return NextResponse.json(
            {
              error:
                updateErr?.message ||
                'Failed to submit custom digital quote request.',
            },
            { status: 500 }
          );
        }
        savedOrder = updated as Record<string, unknown>;
      } else {
        const { data: inserted, error: insertErr } = await actor.supabaseAdmin
          .from('print_orders')
          .insert({
            order_code: generatePrintOrderCode(),
            hub_id: profile.hub_id,
            listing_id: profile.listing_id,
            customer_id: actor.userId,
            is_first_party_order: profile.is_first_party_printswift,
            job_mode: 'custom_digital',
            service_category_slug: serviceCategorySlug,
            customer_instructions: customerInstructions,
            handover_mode: handoverMode,
            sealed_envelope_requested: sealedEnvelopeRequested,
            phone_otp_verified_at: actor.profile.phone_verified_at,
            collection_otp_hash: collectionOtpHash,
            collection_otp_display_for_customer: collectionOtp,
            quote_status: 'awaiting_shop_quote',
            payment_status: 'not_required_yet',
            fulfillment_status: 'draft',
            settlement_status: 'not_applicable',
            purge_status: 'active',
          })
          .select('*')
          .single();

        if (insertErr || !inserted) {
          return NextResponse.json(
            {
              error:
                insertErr?.message ||
                'Failed to create custom digital quote request.',
            },
            { status: 500 }
          );
        }
        savedOrder = inserted as Record<string, unknown>;
      }

      await actor.supabaseAdmin.from('print_order_events').insert({
        print_order_id: String(savedOrder.id),
        actor_id: actor.userId,
        actor_role: actor.actualRole,
        event_type: 'order_submitted',
        metadata: {
          job_mode: 'custom_digital',
          service_category_slug: serviceCategorySlug,
          handover_mode: handoverMode,
          quote_status: 'awaiting_shop_quote',
        },
      });

      return NextResponse.json(
        {
          order: savedOrder,
          collectionOtp,
        },
        { status: 201 }
      );
    }

    // =========================================================================
    // MODE A: Instant Print (`instant_print`)
    // =========================================================================
    if (!existingOrder) {
      return NextResponse.json(
        {
          error:
            'orderId with uploaded files is required for Instant Print submission.',
        },
        { status: 400 }
      );
    }

    const orderId = String(existingOrder.id);

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
        { error: `Failed to verify uploaded files: ${filesErr.message}` },
        { status: 500 }
      );
    }

    const activeFiles = (fileRows || []) as PrintOrderFile[];
    if (activeFiles.length === 0) {
      return NextResponse.json(
        {
          error:
            'Please upload at least one valid PDF or image before submitting your print order.',
        },
        { status: 400 }
      );
    }

    const fileOptionsInput = Array.isArray(body.fileOptions)
      ? (body.fileOptions as Array<
          { fileId?: string; file_id?: string; options?: PrintFileOptions } & PrintFileOptions
        >)
      : body.requestedOptions &&
          typeof body.requestedOptions === 'object' &&
          !Array.isArray(body.requestedOptions)
        ? (body.requestedOptions as PrintFileOptions)
        : undefined;

    // Recalculate fresh server-authoritative quote snapshot stamped with current pricing_version
    const quoteResult = calculatePrintQuote({
      profile,
      files: activeFiles,
      requestedOptions: fileOptionsInput,
      handoverMode,
      sealedEnvelopeRequested,
      customerNoShowCount: actor.profile.print_no_show_count,
      jobMode: 'instant_print',
    });

    const requestedRailRaw = body.paymentRail ?? body.payment_rail;
    let resolvedRail: PrintPaymentRail;

    if (quoteResult.forcedEscrow) {
      if (
        isValidPaymentRail(requestedRailRaw) &&
        requestedRailRaw !== 'platform_escrow'
      ) {
        return NextResponse.json(
          {
            error:
              quoteResult.forcedEscrowReason ||
              'Platform Escrow is required for this print order.',
            code: 'ESCROW_REQUIRED',
            allowedPaymentRails: quoteResult.allowedPaymentRails,
          },
          { status: 400 }
        );
      }
      resolvedRail = 'platform_escrow';
    } else if (isValidPaymentRail(requestedRailRaw)) {
      if (!quoteResult.allowedPaymentRails.includes(requestedRailRaw)) {
        return NextResponse.json(
          {
            error: `Payment rail "${requestedRailRaw}" is not enabled for this shop.`,
            allowedPaymentRails: quoteResult.allowedPaymentRails,
          },
          { status: 400 }
        );
      }
      resolvedRail = requestedRailRaw;
    } else {
      resolvedRail = quoteResult.allowedPaymentRails[0] || 'platform_escrow';
    }

    // Persist normalized file options
    await Promise.all(
      quoteResult.quoteSnapshot.files.map((item) =>
        actor.supabaseAdmin
          .from('print_order_files')
          .update({ print_options: item.options })
          .eq('id', item.file_id)
      )
    );

    const totalAmountInr = quoteResult.quoteSnapshot.total_amount_inr;

    // -------------------------------------------------------------------------
    // Rail 1: Platform Escrow -> create linked payment_intents row
    // -------------------------------------------------------------------------
    if (resolvedRail === 'platform_escrow') {
      const paymentPurpose: PaymentPurpose =
        handoverMode === 'pick_n_drop'
          ? 'print_order_with_delivery'
          : 'print_order';

      const expiresAtIso = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const roundedAmount = Math.round(totalAmountInr * 100) / 100;

      const { data: intentRow, error: intentErr } = await actor.supabaseAdmin
        .from('payment_intents')
        .insert({
          intent_code: generatePaymentIntentCode(),
          user_id: actor.userId,
          hub_id: profile.hub_id,
          purpose: paymentPurpose,
          reference_id: orderId,
          print_order_id: orderId,
          amount_inr: roundedAmount,
          base_amount_inr: roundedAmount,
          provider,
          status: 'awaiting_payment',
          expires_at: expiresAtIso,
        })
        .select('*')
        .single();

      if (intentErr || !intentRow) {
        return NextResponse.json(
          {
            error:
              intentErr?.message ||
              'Failed to initialize Platform Escrow payment intent.',
          },
          { status: 500 }
        );
      }

      const paymentIntent = intentRow as PaymentIntentRecord;

      const { data: updatedOrder, error: orderUpdateErr } =
        await actor.supabaseAdmin
          .from('print_orders')
          .update({
            hub_id: profile.hub_id,
            job_mode: 'instant_print',
            service_category_slug: serviceCategorySlug,
            customer_instructions: customerInstructions,
            quote_snapshot: quoteResult.quoteSnapshot,
            quoted_amount_inr: roundedAmount,
            platform_fee_inr: quoteResult.quoteSnapshot.platform_fee_inr,
            payment_rail: 'platform_escrow',
            payment_intent_id: paymentIntent.id,
            handover_mode: handoverMode,
            sealed_envelope_requested: sealedEnvelopeRequested,
            phone_otp_verified_at: actor.profile.phone_verified_at,
            collection_otp_hash: collectionOtpHash,
            collection_otp_display_for_customer: collectionOtp,
            quote_status: 'quoted',
            payment_status: 'unpaid',
            fulfillment_status: 'draft',
            settlement_status: profile.is_first_party_printswift
              ? 'not_applicable'
              : 'locked',
            updated_at: nowIso,
          })
          .eq('id', orderId)
          .select('*')
          .single();

      if (orderUpdateErr || !updatedOrder) {
        return NextResponse.json(
          {
            error:
              orderUpdateErr?.message ||
              'Failed to finalize print order for escrow payment.',
          },
          { status: 500 }
        );
      }

      await actor.supabaseAdmin.from('print_order_events').insert({
        print_order_id: orderId,
        actor_id: actor.userId,
        actor_role: actor.actualRole,
        event_type: 'order_submitted',
        metadata: {
          job_mode: 'instant_print',
          payment_rail: 'platform_escrow',
          payment_intent_id: paymentIntent.id,
          intent_code: paymentIntent.intent_code,
          handover_mode: handoverMode,
          quoted_amount_inr: roundedAmount,
          pricing_version: profile.pricing_version,
        },
      });

      const paymentConfig = await fetchServerPaymentConfig(
        actor.supabaseAdmin,
        profile.hub_id
      );
      const upiDetails = buildPlatformUpiDetails({
        intentCode: paymentIntent.intent_code,
        amountInr: Number(paymentIntent.amount_inr || roundedAmount),
        purpose: paymentPurpose,
        upiIdOverride: paymentConfig.upi_id,
        upiPayeeNameOverride: paymentConfig.upi_payee_name,
      });

      return NextResponse.json(
        {
          order: updatedOrder,
          paymentIntent,
          upiDetails,
          collectionOtp,
          quoteSnapshot: quoteResult.quoteSnapshot,
        },
        { status: 201 }
      );
    }

    // -------------------------------------------------------------------------
    // Rail 2: Direct-to-Shop (`direct_counter` or `direct_shop_upi`)
    // -------------------------------------------------------------------------
    const roundedAmount = Math.round(totalAmountInr * 100) / 100;

    const { data: confirmedOrder, error: confirmErr } =
      await actor.supabaseAdmin
        .from('print_orders')
        .update({
          hub_id: profile.hub_id,
          job_mode: 'instant_print',
          service_category_slug: serviceCategorySlug,
          customer_instructions: customerInstructions,
          quote_snapshot: quoteResult.quoteSnapshot,
          quoted_amount_inr: roundedAmount,
          platform_fee_inr: quoteResult.quoteSnapshot.platform_fee_inr,
          payment_rail: resolvedRail,
          handover_mode: handoverMode,
          sealed_envelope_requested: sealedEnvelopeRequested,
          phone_otp_verified_at: actor.profile.phone_verified_at,
          collection_otp_hash: collectionOtpHash,
          collection_otp_display_for_customer: collectionOtp,
          quote_status: 'accepted',
          payment_status: 'unpaid',
          fulfillment_status: 'confirmed',
          settlement_status: 'not_applicable',
          updated_at: nowIso,
        })
        .eq('id', orderId)
        .select('*')
        .single();

    if (confirmErr || !confirmedOrder) {
      return NextResponse.json(
        {
          error:
            confirmErr?.message ||
            'Failed to confirm direct-pay print order.',
        },
        { status: 500 }
      );
    }

    await actor.supabaseAdmin.from('print_order_events').insert({
      print_order_id: orderId,
      actor_id: actor.userId,
      actor_role: actor.actualRole,
      event_type: 'order_submitted',
      metadata: {
        job_mode: 'instant_print',
        payment_rail: resolvedRail,
        handover_mode: handoverMode,
        quoted_amount_inr: roundedAmount,
        pricing_version: profile.pricing_version,
      },
    });

    const shopUpi =
      resolvedRail === 'direct_shop_upi'
        ? buildShopDirectUpiDetails({
            shopUpiId: profile.payment_policy.shop_upi_id,
            shopUpiName: profile.payment_policy.shop_upi_name,
            orderCode: String(confirmedOrder.order_code || ''),
            amountInr: roundedAmount,
            verified: profile.payment_policy.shop_upi_verified,
          })
        : null;

    return NextResponse.json(
      {
        order: confirmedOrder,
        collectionOtp,
        shopUpi,
        quoteSnapshot: quoteResult.quoteSnapshot,
      },
      { status: 201 }
    );
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
            : 'Unexpected error while submitting print order.',
      },
      { status: 500 }
    );
  }
}
