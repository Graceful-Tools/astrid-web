# Email Setup Guide

This guide explains how to set up email delivery for your task management application using Resend or other email services.

## Current Setup

The application uses a **dual email system**:
- **Cloudflare Email Routing**: For receiving emails (e.g., `remindme@astrid.cc`). The webhook now **requires** the `CLOUDFLARE_EMAIL_WEBHOOK_SECRET` shared secret — the Email Worker sends it as the `x-astrid-webhook-secret` header, and the same value must be set in Vercel Production or inbound email is rejected with HTTP 401 (see [CLOUDFLARE_EMAIL_SETUP.md](./CLOUDFLARE_EMAIL_SETUP.md)).
- **Resend**: For sending emails (verification, invitations, reminders)

> **New**: For complete Cloudflare + Resend setup, see [CLOUDFLARE_EMAIL_SETUP.md](./CLOUDFLARE_EMAIL_SETUP.md)

## Environment Variables Required

Add these variables to your `.env.local` file:

```bash
# Resend Configuration
RESEND_API_KEY="re_your-resend-api-key-here"
FROM_EMAIL="noreply@yourdomain.com"

# These should already be set
NEXTAUTH_URL="http://localhost:3000"  # or your production URL
NODE_ENV="development"  # or "production"
```

## Resend Setup (Recommended)

### 1. Create a Resend Account
- Go to [resend.com](https://resend.com)
- Sign up for a free account
- Free tier includes 3,000 emails/month

### 2. Get Your API Key
- In your Resend dashboard, go to "API Keys"
- Click "Create API Key"
- Copy the key (starts with `re_`)

### 3. Verify Your Domain (Production)
For production, you'll need to verify your sending domain:
- Go to "Domains" in Resend dashboard
- Add your domain (e.g., `yourdomain.com`)
- Follow DNS setup instructions
- Use verified domain in `FROM_EMAIL` (e.g., `noreply@yourdomain.com`)

### 4. Set Environment Variables
```bash
RESEND_API_KEY="re_your_actual_api_key_here"
FROM_EMAIL="noreply@yourdomain.com"  # Use your verified domain
```

## Alternative Email Services

The code can be easily adapted for other services:

### SendGrid
```bash
SENDGRID_API_KEY="SG.your-sendgrid-key"
FROM_EMAIL="noreply@yourdomain.com"
```

### Mailgun
```bash
MAILGUN_API_KEY="your-mailgun-key"
MAILGUN_DOMAIN="yourdomain.com"
FROM_EMAIL="noreply@yourdomain.com"
```

## Email Types Sent

The application sends these types of emails:

### 1. **Task Assignment Invitations**
- Sent when assigning tasks to new users
- Contains invitation link to join the platform
- Expires in 7 days

### 2. **Email Verification**
- Sent when users verify their email address
- Sent when users change their email address
- Expires in 24 hours

### 3. **List Sharing Invitations**
- Sent when sharing task lists with other users
- Contains invitation link to join the list
- Expires in 7 days

## Development vs Production

### Development Mode
- `NODE_ENV="development"` OR missing `RESEND_API_KEY`
- Emails are logged to console instead of sent
- No actual email delivery
- Perfect for testing

### Production Mode
- `NODE_ENV="production"` AND `RESEND_API_KEY` is set
- Emails are sent via Resend
- Requires verified domain for deliverability

## Testing Email Delivery

### 1. Development Testing
```bash
# Set in .env.local
NODE_ENV="development"
```
Check your console for email logs when triggering email actions.

### 2. Production Testing
```bash
# Set in .env.local
NODE_ENV="production"
RESEND_API_KEY="re_your_test_key"
FROM_EMAIL="test@yourverifieddomain.com"
```

## Email Templates

The application includes professional email templates:

- **HTML templates** with modern styling
- **Plain text fallbacks** for compatibility
- **Responsive design** for mobile devices
- **Clear call-to-action buttons**
- **Security warnings** for sensitive actions

## Troubleshooting

### Common Issues

1. **Emails not sending in production**
   - Check `RESEND_API_KEY` is set correctly
   - Verify `FROM_EMAIL` uses a verified domain
   - Check Resend dashboard for errors

2. **Domain verification issues**
   - Ensure DNS records are set correctly
   - Wait for DNS propagation (up to 24 hours)
   - Check domain status in Resend dashboard

3. **High bounce rates**
   - Use a verified domain for `FROM_EMAIL`
   - Avoid spam-trigger words in subject lines
   - Include unsubscribe links (Resend adds automatically)

### Debugging

Enable detailed logging by checking your server logs when emails are sent. The application logs:
- Email send attempts
- Resend API responses
- Error messages with details

## Cost Considerations

### Resend Pricing (as of 2024)
- **Free tier**: 3,000 emails/month
- **Pro tier**: $20/month for 50,000 emails
- **Excellent deliverability** and developer experience

### Volume Estimates
For a typical task management app:
- **Small team (10 users)**: ~100-500 emails/month
- **Medium team (50 users)**: ~500-2,000 emails/month
- **Large team (200 users)**: ~2,000-8,000 emails/month

Most teams will stay within the free tier limits.

## Security Best Practices

1. **Keep API keys secure**
   - Never commit API keys to version control
   - Use environment variables
   - Rotate keys periodically

2. **Use verified domains**
   - Improves deliverability
   - Reduces spam flags
   - Builds user trust

3. **Monitor email delivery**
   - Check Resend dashboard for bounces
   - Monitor unsubscribe rates
   - Watch for spam complaints

## Next Steps

1. Set up your Resend account
2. Verify your domain
3. Add environment variables
4. Test email delivery
5. Monitor performance in production

For questions or issues, check the Resend documentation at [resend.com/docs](https://resend.com/docs).
