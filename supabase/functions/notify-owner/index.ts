declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

export interface ListingRecordPayload {
  id: string;
  title?: string;
  status?: string;
  owner_id?: string;
  owner_phone?: string;
  whatsapp?: string;
  phone?: string;
  moderation_note?: string;
}

export interface SupabaseWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: ListingRecordPayload | null;
  old_record: ListingRecordPayload | null;
}

async function sendMockTwilioNotification(params: {
  to: string;
  channel: 'whatsapp' | 'sms';
  body: string;
  listingId: string;
  newStatus: 'published' | 'rejected';
}) {
  const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const twilioFromNumber =
    Deno.env.get('TWILIO_FROM_NUMBER') || 'whatsapp:+14155238886';

  // If live Twilio credentials are configured, dispatch via Twilio REST API;
  // otherwise return a structured mock dispatch confirmation.
  if (twilioAccountSid && twilioAuthToken) {
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
    const formattedTo =
      params.channel === 'whatsapp' && !params.to.startsWith('whatsapp:')
        ? `whatsapp:${params.to}`
        : params.to;

    const formBody = new URLSearchParams({
      To: formattedTo,
      From: twilioFromNumber,
      Body: params.body,
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
    });

    return {
      provider: 'twilio-live',
      ok: response.ok,
      status: response.status,
      recipient: formattedTo,
      listingId: params.listingId,
      newStatus: params.newStatus,
    };
  }

  return {
    provider: 'twilio-mock',
    ok: true,
    status: 200,
    recipient: params.to,
    channel: params.channel,
    messagePreview: params.body,
    listingId: params.listingId,
    newStatus: params.newStatus,
    dispatchedAt: new Date().toISOString(),
  };
}

export async function handleNotifyOwnerRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method Not Allowed. Expected POST webhook.' }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const payload = (await req.json()) as SupabaseWebhookPayload;
    const record = payload?.record;
    const oldRecord = payload?.old_record;

    if (!record || payload.table !== 'listings') {
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: 'Webhook payload does not target a valid listings record.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const nextStatus = record.status;
    const previousStatus = oldRecord?.status;

    // Only trigger notification when status transitions to 'published' or 'rejected'
    const isTargetTransition =
      (nextStatus === 'published' || nextStatus === 'rejected') &&
      nextStatus !== previousStatus;

    if (!isTargetTransition) {
      return new Response(
        JSON.stringify({
          skipped: true,
          listingId: record.id,
          previousStatus: previousStatus ?? null,
          currentStatus: nextStatus ?? null,
          reason:
            'Status did not transition to published or rejected; no alert sent.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const recipientNumber =
      record.whatsapp ||
      record.owner_phone ||
      record.phone ||
      '+919862000000';
    const listingTitle = record.title || `Listing #${record.id}`;

    const messageBody =
      nextStatus === 'published'
        ? `[PrintSwift Local] Congratulations! Your listing "${listingTitle}" has been approved and is now live on the Churachandpur Discovery Map.`
        : `[PrintSwift Local] Update on your listing "${listingTitle}": Your submission was marked as rejected during verification.${
            record.moderation_note ? ` Note: ${record.moderation_note}` : ''
          } Please review and update your listing in the Owner Workspace.`;

    const dispatchResult = await sendMockTwilioNotification({
      to: recipientNumber,
      channel: 'whatsapp',
      body: messageBody,
      listingId: record.id,
      newStatus: nextStatus,
    });

    return new Response(
      JSON.stringify({
        notified: true,
        listingId: record.id,
        status: nextStatus,
        dispatch: dispatchResult,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to process notify-owner webhook payload.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(handleNotifyOwnerRequest);
}
