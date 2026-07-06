# Cloudflare Email Routing + Resend Setup

Complete guide for using **Cloudflare Email Routing** (for receiving/forwarding) alongside **Resend** (for sending) on the same domain.

## Overview

This setup allows you to:
- ✅ **Receive emails** via Cloudflare Email Routing (free, unlimited addresses)
- ✅ **Forward emails** to your webhook for the `remindme@astrid.cc` feature
- ✅ **Send emails** via Resend (verification, invitations, reminders)
- ✅ Both services work together on `astrid.cc` domain

## Architecture

```
Inbound Email Flow (Cloudflare):
User sends email → Cloudflare MX servers → Email Worker → Your webhook → Task created

Outbound Email Flow (Resend):
Your app → Resend API → Recipient's inbox
```

## Prerequisites

- Cloudflare account with domain `astrid.cc` added
- Resend account with API key
- Domain DNS managed by Cloudflare
- Webhook endpoint deployed at `https://www.astrid.cc/api/webhooks/email`

## Step 1: Configure Cloudflare Email Routing

### 1.1 Enable Email Routing

1. Log in to Cloudflare dashboard
2. Select your domain: `astrid.cc`
3. Navigate to **Email** → **Email Routing**
4. Click **Get started** (if not already enabled)

### 1.2 Verify DNS Records

Cloudflare automatically adds these MX records:

```
Type: MX
Name: @
Value: isaac.mx.cloudflare.net (or route1.mx.cloudflare.net)
Priority: 1

Type: MX
Name: @
Value: linda.mx.cloudflare.net (or route2.mx.cloudflare.net)
Priority: 10

Type: TXT
Name: @
Value: v=spf1 include:_spf.mx.cloudflare.net include:_spf.resend.com ~all
```

**Important**: The SPF record includes **both** Cloudflare and Resend to allow:
- Cloudflare to receive emails
- Resend to send emails

### 1.3 Create Email Worker for Webhook Integration

1. Go to **Email** → **Email Routing** → **Routes**
2. Click **Create route**
3. Configure:
   - **Matcher**: Custom address → `remindme@astrid.cc`
   - **Action**: Send to a Worker
4. Click **Create Worker** (or edit existing)

**Email Worker Code**:
```javascript
export default {
  async email(message, env, ctx) {
    // Simple worker: just extract metadata and forward raw email to server
    // The server (astrid.cc) handles all MIME parsing - easier to maintain!

    const emailData = {
      from: message.from,
      to: message.to,
      subject: message.headers.get('subject') || '',
      cc: message.headers.get('cc') || '',
      raw: await new Response(message.raw).text()  // Send raw MIME email
    };

    console.log('📧 Forwarding email:', emailData.from, '→', emailData.subject);

    const webhookUrl = 'https://www.astrid.cc/api/webhooks/email';

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Cloudflare-Email-Worker/2.0',
          'x-astrid-webhook-secret': env.CLOUDFLARE_EMAIL_WEBHOOK_SECRET
        },
        body: JSON.stringify(emailData)
      });

      console.log('✅ Webhook response:', response.status);

      if (!response.ok) {
        const error = await response.text();
        console.error('❌ Webhook error:', error);
      }
    } catch (error) {
      console.error('❌ Webhook failed:', error.message);
    }
  }
};
```

**Architecture Benefits:**
- ✅ **Simple Worker** - Only 30 lines, minimal complexity
- ✅ **Server-side MIME parsing** - All parsing logic lives on astrid.cc
- ✅ **Easy maintenance** - Update parser without touching Cloudflare
- ✅ **Better error handling** - Full server logs and debugging
- ✅ **Testable** - Can write unit tests for the MIME parser
- ✅ **Version control** - Parser changes tracked in git

**Required — add the webhook secret variable:**

In the Worker's **Settings → Variables**, add an **encrypted** variable named `CLOUDFLARE_EMAIL_WEBHOOK_SECRET`. The Worker sends its value as the `x-astrid-webhook-secret` header. The webhook is fail-closed: without a matching secret it returns HTTP 401. Generate the value with `openssl rand -hex 32` and use the **same value** in Vercel Production (see Step 3.2).

5. Click **Save and Deploy**
6. Return to Routes and finish creating the route

### 1.4 Test Email Routing

Send a test email to `remindme@astrid.cc` and check:
1. Cloudflare Email Routing dashboard (should show delivery)
2. Worker logs (should show webhook call)
3. Your application logs (should show task creation)

## Step 2: Configure Resend for Outbound Email

### 2.1 Verify Domain in Resend

1. Log in to Resend dashboard
2. Navigate to **Domains** → **Add Domain**
3. Enter: `astrid.cc`
4. Choose **Sending** as domain type
5. Add the DKIM record provided by Resend:

```
Type: TXT
Name: resend._domainkey
Value: [Provided by Resend - starts with "p="]
TTL: 3600
```

**Note**: This is separate from Cloudflare's MX records and won't conflict.

### 2.2 Verify SPF Record

Ensure your SPF record includes both Cloudflare and Resend:

```
Type: TXT
Name: @
Value: v=spf1 include:_spf.mx.cloudflare.net include:_spf.resend.com ~all
```

This authorizes both services to send/receive email for your domain.

### 2.3 Add DMARC Record (Recommended)

```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=none; rua=mailto:dmarc@astrid.cc; pct=100; adkim=s; aspf=s
```

This improves email deliverability and helps prevent spoofing.

## Step 3: Configure Application Environment Variables

### 3.1 Local Development (`.env.local`)

```bash
# Resend Configuration (for sending emails)
RESEND_API_KEY=re_your_resend_api_key_here
FROM_EMAIL=noreply@astrid.cc

# Optional: Resend webhook secret (if using Resend inbound in the future)
RESEND_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

### 3.2 Production (Vercel Environment Variables)

1. Go to Vercel dashboard → Project Settings → Environment Variables
2. Add:
   - `RESEND_API_KEY`: Your Resend API key
   - `FROM_EMAIL`: `noreply@astrid.cc`
   - `CLOUDFLARE_EMAIL_WEBHOOK_SECRET`: the **same** value set in the Email Worker (byte-identical — no trailing newline/space)
3. Redeploy application

> **Important**: Vercel binds env vars at deploy time. After adding `CLOUDFLARE_EMAIL_WEBHOOK_SECRET`, trigger a fresh production deployment or the running deployment will keep rejecting inbound email with HTTP 401.

## Step 4: Testing Both Services

### Test 1: Inbound Email (Cloudflare → Webhook)

Send an email to test task creation:

```bash
# Test self-task creation
echo "Buy groceries: milk, eggs, bread" | mail -s "Shopping List" remindme@astrid.cc
```

**Expected Result**:
- ✅ Email received by Cloudflare
- ✅ Email Worker forwards to webhook
- ✅ Webhook creates task
- ✅ Task appears in your task list

**Check logs**:
```bash
# Cloudflare Worker logs
# (View in Cloudflare Dashboard → Workers → Logs)

# Application logs
vercel logs --project=astrid-www --follow
```

### Test 2: Outbound Email (Resend)

Trigger an email send (e.g., invite a user to a list):

1. Create a new task list
2. Invite someone via email
3. Check Resend dashboard for delivery status

**Expected Result**:
- ✅ Email sent via Resend API
- ✅ Email delivered to recipient
- ✅ Email has proper DKIM/SPF signatures
- ✅ No spam/bounce issues

## DNS Configuration Summary

Here's your complete DNS setup for Cloudflare + Resend:

```
# MX Records (Cloudflare Email Routing - for receiving)
MX @ isaac.mx.cloudflare.net Priority: 1
MX @ linda.mx.cloudflare.net Priority: 10

# SPF Record (Both Cloudflare and Resend)
TXT @ v=spf1 include:_spf.mx.cloudflare.net include:_spf.resend.com ~all

# DKIM Record (Resend - for sending authentication)
TXT resend._domainkey [Value from Resend dashboard]

# DMARC Record (Email authentication policy)
TXT _dmarc v=DMARC1; p=none; rua=mailto:dmarc@astrid.cc
```

## Troubleshooting

### Issue: 405 Method Not Allowed

**Symptom**: Worker logs show "405" response from webhook

**Solution**:
- ✅ **FIXED**: Webhook now supports Cloudflare Email Worker format
- The webhook automatically detects Cloudflare via `User-Agent` or `cf-ray` headers
- Ensure you're using the updated webhook code

### Issue: 401 Unauthorized

**Symptom**: Worker logs show "401" response from webhook; no task created

**Solution**: The `CLOUDFLARE_EMAIL_WEBHOOK_SECRET` shared secret is missing or mismatched.
- Confirm the Worker has an encrypted `CLOUDFLARE_EMAIL_WEBHOOK_SECRET` variable and sends it as the `x-astrid-webhook-secret` header
- Confirm the same value is set in Vercel Production, byte-identical (no trailing newline/space)
- If you just added the Vercel var, trigger a fresh production deployment so it takes effect

### Issue: Emails Not Received

**Check Cloudflare Email Routing**:
1. Dashboard → Email → Email Routing → Activity log
2. Look for delivery status
3. Check if route is active

**Check MX Records**:
```bash
dig MX astrid.cc
# Should show Cloudflare's MX servers
```

### Issue: Webhook Not Called

**Check Worker Logs**:
1. Cloudflare Dashboard → Workers → Your Worker → Logs
2. Look for errors or HTTP status codes
3. Verify webhook URL is correct

**Test Worker Directly**:
```bash
# Send test email via Cloudflare Email Routing test feature
# Check if Worker executes and calls webhook
```

### Issue: Resend Emails Marked as Spam

**Check SPF/DKIM**:
```bash
# Verify SPF record
dig TXT astrid.cc | grep spf1

# Verify DKIM record
dig TXT resend._domainkey.astrid.cc
```

**Check Resend Dashboard**:
- Look for bounce/spam reports
- Verify domain is fully verified
- Check email content for spam triggers

### Issue: DMARC Failures

**Verify DMARC Record**:
```bash
dig TXT _dmarc.astrid.cc
```

**Check Email Headers**:
- Use mail-tester.com to test deliverability
- Verify DKIM and SPF alignment

## Advanced Configuration

### Email Forwarding Setup

All astrid.cc emails are forwarded to `jon@gracefultools.com`:

| Address | Action | Destination |
|---------|--------|-------------|
| `remindme@astrid.cc` | Send to Worker | Webhook (task creation) |
| `legal@astrid.cc` | Forward | jon@gracefultools.com |
| `privacy@astrid.cc` | Forward | jon@gracefultools.com |
| `support@astrid.cc` | Forward | jon@gracefultools.com |
| `*@astrid.cc` (catch-all) | Forward | jon@gracefultools.com |

**Setup in Cloudflare:**

1. Go to **Email → Email Routing → Destination addresses**
2. Add `jon@gracefultools.com` and verify via email link
3. Go to **Routes** and create each forwarding rule
4. Enable **Catch-all** to forward all unmatched addresses

### Contact Emails

These addresses are referenced in the app:
- `legal@astrid.cc` - Terms of Service inquiries
- `privacy@astrid.cc` - Privacy Policy inquiries
- `support@astrid.cc` - General support

### Multiple Email Addresses

You can create additional routes in Cloudflare for different email addresses:

```
remindme@astrid.cc → Send to Worker (webhook for task creation)
legal@astrid.cc → Forward to jon@gracefultools.com
privacy@astrid.cc → Forward to jon@gracefultools.com
support@astrid.cc → Forward to jon@gracefultools.com
*@astrid.cc → Catch-all forward to jon@gracefultools.com
```

### Webhook Security (Required)

The webhook is **fail-closed**: the Cloudflare Email Worker branch requires a shared secret. If the secret is unset or mismatched, the webhook responds with HTTP 401 `{"error":"Unauthorized"}` and no task is created.

The Email Worker must send the secret as the `x-astrid-webhook-secret` header:

```javascript
// In Worker code — CLOUDFLARE_EMAIL_WEBHOOK_SECRET is an encrypted Worker variable
const response = await fetch(webhookUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-astrid-webhook-secret': env.CLOUDFLARE_EMAIL_WEBHOOK_SECRET
  },
  body: JSON.stringify(emailData)
});
```

The webhook verifies the secret:
```typescript
// In app/api/webhooks/email/route.ts
const secret = request.headers.get('x-astrid-webhook-secret');
if (secret !== process.env.CLOUDFLARE_EMAIL_WEBHOOK_SECRET) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

**Setup:**
1. Generate the value: `openssl rand -hex 32`
2. Add it as an encrypted `CLOUDFLARE_EMAIL_WEBHOOK_SECRET` variable in the Email Worker.
3. Set the **same** value in Vercel as `CLOUDFLARE_EMAIL_WEBHOOK_SECRET` (Production), byte-identical.
4. Trigger a fresh production deployment so Vercel picks up the var.

## Monitoring & Maintenance

### Key Metrics to Track

**Cloudflare Email Routing**:
- Daily email volume
- Delivery success rate
- Worker execution time
- Webhook call failures

**Resend**:
- Email send volume
- Bounce rate
- Spam complaint rate
- Delivery rate

### Email Volume Limits

**Cloudflare Email Routing**:
- Free tier: Unlimited receiving
- Worker: 100,000 requests/day (free tier)

**Resend**:
- Free tier: 3,000 emails/month, 100/day
- Pro tier: $20/month for 50,000 emails

### Setting Up Alerts

**Cloudflare Worker Alerts**:
1. Workers → Your Worker → Settings → Triggers
2. Add alert for errors/failures

**Resend Alerts**:
- Check dashboard daily for bounces/spam reports
- Set up webhook for delivery notifications

## Migration Notes

### From Resend Inbound Only

If you were using Resend for inbound email:

1. Update MX records from `inbound.resend.com` to Cloudflare's MX servers
2. Deploy Email Worker with webhook integration
3. Keep Resend API key for outbound emails
4. Test both inbound and outbound flows

### From Mailgun

If migrating from Mailgun:

1. Update MX records to Cloudflare
2. Deploy Email Worker
3. Switch outbound to Resend
4. Update `FROM_EMAIL` to use Resend-verified domain
5. Remove Mailgun DNS records after testing

## Support & Documentation

- **Cloudflare Email Routing**: https://developers.cloudflare.com/email-routing/
- **Cloudflare Workers**: https://developers.cloudflare.com/workers/
- **Resend Docs**: https://resend.com/docs
- **Webhook Handler**: [/app/api/webhooks/email/route.ts](/app/api/webhooks/email/route.ts)

---

**Last Updated**: 2026-01-03
**Status**: ✅ Active (Cloudflare + Resend)
