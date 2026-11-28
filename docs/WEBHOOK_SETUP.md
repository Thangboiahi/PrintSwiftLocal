# Supabase Automated Verification Webhook Setup (`notify-owner`)

This guide explains how to deploy the `notify-owner` Supabase Edge Function and configure a Database Webhook in the Supabase Dashboard to automatically notify listing owners via SMS/WhatsApp whenever a listing's moderation status changes to `published` or `rejected`.

---

## 1. Deploy the Edge Function

From the project root with the Supabase CLI authenticated:

```bash
supabase functions deploy notify-owner
```

---

## 2. Configure Communication API Secrets (Optional Live Mode)

By default, `notify-owner` runs in **mock dispatch mode** (`twilio-mock`) and returns a structured payload preview when Twilio credentials are not set. To enable live WhatsApp/SMS delivery via Twilio, set the following Edge Function secrets:

```bash
supabase secrets set TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
supabase secrets set TWILIO_AUTH_TOKEN="your_twilio_auth_token"
supabase secrets set TWILIO_FROM_NUMBER="whatsapp:+14155238886"
```

---

## 3. Configure the Supabase Database Webhook

1. Open your **Supabase Project Dashboard** and navigate to **Database → Webhooks**.
2. Click **Enable Webhooks** (if not already enabled), then click **Create a new hook**.
3. Configure the webhook settings as follows:
   - **Name**: `notify_owner_on_listing_moderation`
   - **Table**: `public.listings`
   - **Events**: Check **`UPDATE`** only
   - **Webhook Type**: Select **Supabase Edge Functions**
   - **Edge Function**: Select `notify-owner` (`POST` method)
   - **HTTP Headers**:
     - `Content-Type`: `application/json`
     - `Authorization`: `Bearer <YOUR_SUPABASE_SERVICE_ROLE_KEY>`
4. Click **Confirm** to activate the webhook.

---

## 4. Verification Behaviour

- Whenever a row in `public.listings` is updated, Supabase sends the `record` and `old_record` JSON payload to `notify-owner`.
- The Edge Function verifies that `record.status !== old_record.status` and that `record.status` is either `'published'` or `'rejected'`.
- Unrelated edits (such as title updates or view count increments where `status` does not transition to `'published'` or `'rejected'`) are safely ignored with `{ skipped: true }`.
