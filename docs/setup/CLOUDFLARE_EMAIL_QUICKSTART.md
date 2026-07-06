# Cloudflare Email + Resend - Quick Reference

## ✅ What's Already Done

- ✅ DNS configured (MX, DKIM, DMARC)
- ✅ Webhook endpoint updated to support Cloudflare
- ✅ Code committed and pushed

## 🔐 Required: Shared Secret

The webhook is fail-closed — it rejects any request without a matching secret (HTTP 401). Before it will accept email, you must:

1. Generate a secret: `openssl rand -hex 32`
2. Add it as an **encrypted variable** named `CLOUDFLARE_EMAIL_WEBHOOK_SECRET` in the Email Worker (the Worker sends it as the `x-astrid-webhook-secret` header).
3. Add the **same value** to Vercel as env var `CLOUDFLARE_EMAIL_WEBHOOK_SECRET` for the **Production** environment.
4. Trigger a fresh production deployment so Vercel picks up the new var.

The value must be byte-identical in Cloudflare and Vercel (watch for a trailing newline or space).

## ⚠️ One DNS Change Required

**Update SPF Record** in Cloudflare Dashboard:

**Current**:
```
v=spf1 include:_spf.mx.cloudflare.net ~all
```

**Change to**:
```
v=spf1 include:_spf.mx.cloudflare.net include:_spf.resend.com ~all
```

**Why**: Authorizes Resend to send emails from `astrid.cc`

---

## 🔧 Cloudflare Email Worker Setup

### 1. Create the Worker

Go to: Cloudflare Dashboard → Email → Email Routing → Routes

**Worker Code** (copy/paste):

```javascript
export default {
  async email(message, env, ctx) {
    // Simple worker: just extract metadata and forward raw email to server
    // The server will handle all MIME parsing (easier to maintain!)

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

**Why this approach is better:**
- ✅ **Simple Worker** - Just 30 lines, easy to understand
- ✅ **Server-side parsing** - MIME parsing happens on astrid.cc
- ✅ **Easy to update** - Fix parsing bugs without touching Cloudflare
- ✅ **Better debugging** - Full server logs for troubleshooting
- ✅ **Testable** - Can write unit tests for the parser

### 2. Create Email Route

**Settings**:
- Matcher: `remindme@astrid.cc`
- Action: Send to Worker (select the worker you created)

### 3. Test

Send email to: `remindme@astrid.cc`

**Expected**:
- ✅ Cloudflare receives email
- ✅ Worker logs show email processing
- ✅ Webhook returns 200 (not 405!)
- ✅ Task appears in your app

---

## 🧪 Testing Checklist

### Test 1: Inbound Email (Cloudflare)
```bash
# From your email client
To: remindme@astrid.cc
Subject: Buy groceries
Body: Milk, eggs, bread
```

**Check**:
- [ ] Cloudflare Email Routing shows delivery
- [ ] Worker logs show execution
- [ ] Webhook logs show 200 response
- [ ] Task created in app

### Test 2: Outbound Email (Resend)
```bash
# Trigger from app
1. Invite someone to a task list
2. Or change your email (triggers verification)
```

**Check**:
- [ ] Email sent via Resend
- [ ] No DKIM/SPF failures
- [ ] Email delivered (not spam)
- [ ] Resend dashboard shows success

---

## 📊 Monitoring

### Cloudflare Email Routing
Dashboard → Email → Email Routing → Activity Log

### Cloudflare Worker
Dashboard → Workers & Pages → [Your Worker] → Logs

### Resend
Dashboard → Emails (https://resend.com/emails)

### Application Logs
```bash
vercel logs --project=astrid-www --follow | grep "📧"
```

---

## 🔍 Troubleshooting

### Issue: Still getting 405 error
**Fix**: Make sure code is deployed to production:
```bash
# Check Vercel deployment status
vercel ls
```

### Issue: Worker not calling webhook
**Check**:
1. Worker logs for errors
2. Webhook URL is correct (`https://www.astrid.cc`)
3. Worker has network access

### Issue: Resend emails go to spam
**Fix**: Verify SPF record includes Resend:
```bash
dig TXT astrid.cc | grep spf1
# Should show: include:_spf.resend.com
```

### Issue: Webhook response: 401 / Unauthorized
**Cause**: The `CLOUDFLARE_EMAIL_WEBHOOK_SECRET` shared secret is missing or mismatched.
**Fix**:
1. Confirm the Worker has an encrypted `CLOUDFLARE_EMAIL_WEBHOOK_SECRET` variable and sends it as the `x-astrid-webhook-secret` header.
2. Confirm the same value is set in Vercel Production (byte-identical — no trailing newline/space).
3. If you just added the Vercel var, trigger a fresh production deployment so it takes effect.

### Issue: Task not created
**Check**:
1. Email from address is valid user OR enable placeholder users
2. Webhook logs show successful processing
3. Database accessible

---

## 📚 Full Documentation

- **Complete Setup Guide**: [docs/setup/CLOUDFLARE_EMAIL_SETUP.md](docs/setup/CLOUDFLARE_EMAIL_SETUP.md)
- **Email Overview**: [docs/setup/EMAIL_SETUP.md](docs/setup/EMAIL_SETUP.md)
- **Resend Inbound**: [docs/setup/RESEND_INBOUND_EMAIL_SETUP.md](docs/setup/RESEND_INBOUND_EMAIL_SETUP.md)

---

## 📬 Email Forwarding

All astrid.cc emails forward to `jon@gracefultools.com`:

| Address | Action |
|---------|--------|
| `remindme@astrid.cc` | Worker → Webhook (task creation) |
| `legal@astrid.cc` | Forward to jon@gracefultools.com |
| `privacy@astrid.cc` | Forward to jon@gracefultools.com |
| `support@astrid.cc` | Forward to jon@gracefultools.com |
| `*@astrid.cc` (catch-all) | Forward to jon@gracefultools.com |

**Setup**: Cloudflare Dashboard → Email → Email Routing → Routes

---

## 🎯 Summary

**Inbound**: Cloudflare Email Routing → Worker → Webhook → Task
**Outbound**: App → Resend API → Recipient
**Forwarding**: legal/privacy/support/catch-all → jon@gracefultools.com

**DNS**: MX (Cloudflare) + SPF (both) + DKIM (both) + DMARC

**Status**: ✅ Code ready, just need to:
1. Update SPF record (add Resend)
2. Set `CLOUDFLARE_EMAIL_WEBHOOK_SECRET` in the Worker (encrypted var) AND in Vercel Production, then redeploy
3. Deploy Cloudflare Email Worker
4. Configure email forwarding routes
5. Test!

---

**Questions?** See full docs or check application logs.
