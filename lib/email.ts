// Email service implementation using Resend
import { Resend } from 'resend'
import { getBaseUrl } from './base-url'
import { BRAND } from '@/lib/brand/config'
import { createLogger } from '@/lib/logger'

const log = createLogger('email')


// Initialize Resend (only in server environment)
const resend = typeof window === 'undefined' && process.env.RESEND_API_KEY 
  ? new Resend(process.env.RESEND_API_KEY)
  : null

/**
 * The From address for outbound mail.
 *
 * `FROM_EMAIL` wins when set. The fallback is derived from the brand rather
 * than hardcoded: this used to fall back to `noreply@yourdomain.com` in
 * development and `onboarding@resend.dev` in production, so a partner who
 * forgot the variable sent mail from a placeholder or from Resend's shared
 * sandbox domain, with nothing tying it to their product (task 229c175c).
 * lib/email-reminder-service.ts next door was already brand-aware; this is the
 * same treatment.
 */
export function getFromEmail(): string {
  const configuredEmail = process.env.FROM_EMAIL?.trim()

  if (configuredEmail) {
    log.info(`📧 Using configured email: ${configuredEmail}`)
    return configuredEmail
  }

  const fallback = `noreply@${BRAND.domain}`
  log.info(`📧 No FROM_EMAIL configured, falling back to the brand domain: ${fallback}`)
  return fallback
}

interface Invitation {
  id: string
  email: string
  token: string
  type: string
  expiresAt: Date
  sender?: {
    name: string | null
    email: string
  } | null
  taskId?: string | null
  listId?: string | null
  message?: string | null
}

export async function sendInvitationEmail(invitation: Invitation) {
  const baseUrl = getBaseUrl()
  const inviteUrl = `${baseUrl}/invite/${invitation.token}`
  
  const subject = getEmailSubject(invitation)
  const htmlBody = getEmailHtml(invitation, inviteUrl)
  const textBody = getEmailText(invitation, inviteUrl)
  const fromEmail = getFromEmail()

  // In development, just log the invitation
  if (process.env.NODE_ENV === "development" || !resend || !process.env.RESEND_API_KEY) {
    log.info({
      to: invitation.email,
      from: invitation.sender?.name || invitation.sender?.email,
      type: invitation.type,
      inviteUrl,
      message: invitation.message || "No message",
      expires: invitation.expiresAt.toLocaleString(),
    }, "📧 Invitation Email (Development Mode)")
    return
  }

  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [invitation.email],
      subject,
      html: htmlBody,
      text: textBody,
    })

    if (error) {
      log.error({ err: error }, 'Resend error:')
      throw new Error(`Email sending failed: ${error.message}`)
    }

    log.info({ id: data?.id, to: invitation.email }, '📧 Email sent successfully:')
    return data
  } catch (error) {
    log.error({ err: error }, 'Error sending invitation email:')
    throw error
  }
}

// Email verification functionality
interface EmailVerificationData {
  email: string
  token: string
  userName: string
  isEmailChange?: boolean
  currentEmail?: string
}

export async function sendVerificationEmail(data: EmailVerificationData) {
  const baseUrl = getBaseUrl()
  const verifyUrl = `${baseUrl}/auth/verify-email?token=${data.token}`
  
  const subject = data.isEmailChange 
    ? "Confirm your new email address"
    : "Verify your email address"
    
  const htmlBody = getVerificationEmailHtml(data, verifyUrl)
  const textBody = getVerificationEmailText(data, verifyUrl)
  const fromEmail = getFromEmail()

  // In development, just log the verification email
  if (process.env.NODE_ENV === "development" || !resend || !process.env.RESEND_API_KEY) {
    log.info({
      to: data.email,
      subject,
      verifyUrl,
      isEmailChange: data.isEmailChange,
    }, "📧 Email Verification (Development Mode)")
    return
  }

  try {
    const { data: emailData, error } = await resend.emails.send({
      from: fromEmail,
      to: [data.email],
      subject,
      html: htmlBody,
      text: textBody,
    })

    if (error) {
      log.error({ err: error }, 'Resend error:')
      throw new Error(`Email sending failed: ${error.message}`)
    }

    log.info({ id: emailData?.id, to: data.email }, '📧 Verification email sent successfully:')
    return emailData
  } catch (error) {
    log.error({ err: error }, 'Error sending verification email:')
    throw error
  }
}

function getVerificationEmailHtml(data: EmailVerificationData, verifyUrl: string): string {
  const action = data.isEmailChange ? "confirm your new email address" : "verify your email address"
  const warning = data.isEmailChange 
    ? `<p><strong>Note:</strong> This will change your email from ${data.currentEmail} to ${data.email}.</p>`
    : ""

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Email Verification</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { background-color: ${BRAND.accentColor}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; }
        .footer { margin-top: 30px; font-size: 12px; color: #666; }
        .warning { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 16px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Email Verification Required</h2>
        <p>Hi ${data.userName},</p>
        <p>Please click the button below to ${action}:</p>
        
        ${warning}
        
        <p>
          <a href="${verifyUrl}" class="button">Verify Email Address</a>
        </p>
        
        <p>Or copy and paste this link into your browser:</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        
        <div class="footer">
          <p>This verification link will expire in 24 hours.</p>
          <p>If you didn't request this verification, you can safely ignore this email.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

function getVerificationEmailText(data: EmailVerificationData, verifyUrl: string): string {
  const action = data.isEmailChange ? "confirm your new email address" : "verify your email address"
  const warning = data.isEmailChange 
    ? `\n\nIMPORTANT: This will change your email from ${data.currentEmail} to ${data.email}.\n`
    : ""

  return `
Email Verification Required

Hi ${data.userName},

Please visit the following link to ${action}:
${verifyUrl}
${warning}
This verification link will expire in 24 hours.

If you didn't request this verification, you can safely ignore this email.
  `.trim()
}

// List invitation functionality
export interface ListInvitationData {
  to: string
  inviterName: string
  listName: string
  role: string
  invitationUrl: string
  message?: string
}

export async function sendListInvitationEmail(data: ListInvitationData) {
  const subject = `${data.inviterName} invited you to collaborate on "${data.listName}"`
  const htmlBody = getListInvitationHtml(data)
  const textBody = getListInvitationText(data)
  const fromEmail = getFromEmail()

  // In development, just log the invitation
  if (process.env.NODE_ENV === "development" || !resend || !process.env.RESEND_API_KEY) {
    log.info({
      to: data.to,
      from: data.inviterName,
      list: data.listName,
      role: data.role,
      invitationUrl: data.invitationUrl,
      message: data.message || "No message",
    }, "📧 List Invitation Email (Development Mode)")
    return
  }

  try {
    const { data: emailData, error } = await resend.emails.send({
      from: fromEmail,
      to: [data.to],
      subject,
      html: htmlBody,
      text: textBody,
    })

    if (error) {
      log.error({ err: error }, 'Resend error:')
      throw new Error(`Email sending failed: ${error.message}`)
    }

    log.info({ id: emailData?.id, to: data.to }, '📧 List invitation email sent successfully:')
    return emailData
  } catch (error) {
    log.error({ err: error }, 'Error sending list invitation email:')
    throw error
  }
}

/**
 * Exported so tests/brands/brand-matrix.test.ts can assert that transactional
 * email is painted in the deployment's own accent colour (task 229c175c).
 */
export function renderListInvitationEmailHtml(data: ListInvitationData): string {
  return getListInvitationHtml(data)
}

function getListInvitationHtml(data: ListInvitationData): string {
  const roleDescription = data.role === "manager" ? "manage the list and its members" : "add and edit tasks"
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>List Collaboration Invitation</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { background-color: ${BRAND.accentColor}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; }
        .footer { margin-top: 30px; font-size: 12px; color: #666; }
        .list-info { background-color: #f8fafc; border-left: 4px solid ${BRAND.accentColor}; padding: 16px; margin: 16px 0; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>You've been invited to collaborate!</h2>
        <p><strong>${data.inviterName}</strong> has invited you to collaborate on the list <strong>"${data.listName}"</strong>.</p>
        
        <div class="list-info">
          <p><strong>Your role:</strong> ${data.role}</p>
          <p>As a ${data.role}, you'll be able to ${roleDescription}.</p>
        </div>
        
        ${data.message ? `<p><em>Message from ${data.inviterName}:</em></p><p>"${data.message}"</p>` : ''}
        
        <p>Click the button below to accept the invitation:</p>
        
        <p>
          <a href="${data.invitationUrl}" class="button">Accept Invitation</a>
        </p>
        
        <p>Or copy and paste this link into your browser:</p>
        <p><a href="${data.invitationUrl}">${data.invitationUrl}</a></p>
        
        <div class="footer">
          <p>This invitation will expire in 7 days.</p>
          <p>If you don't want to receive these emails, you can ignore this invitation.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

function getListInvitationText(data: ListInvitationData): string {
  const roleDescription = data.role === "manager" ? "manage the list and its members" : "add and edit tasks"

  return `
You've been invited to collaborate!

${data.inviterName} has invited you to collaborate on the list "${data.listName}".

Your role: ${data.role}
As a ${data.role}, you'll be able to ${roleDescription}.

${data.message ? `Message from ${data.inviterName}: "${data.message}"` : ''}

Accept the invitation by visiting: ${data.invitationUrl}

This invitation will expire in 7 days.

If you don't want to receive these emails, you can ignore this invitation.
  `.trim()
}

function getEmailSubject(invitation: Invitation): string {
  const senderName = invitation.sender?.name || "Someone"
  
  switch (invitation.type) {
    case "TASK_ASSIGNMENT":
      return `${senderName} assigned you a task`
    case "LIST_SHARING":
      return `${senderName} shared a task list with you`
    case "WORKSPACE_INVITE":
      return `${senderName} invited you to join their workspace`
    default:
      return `You've been invited to collaborate`
  }
}

function getEmailHtml(invitation: Invitation, inviteUrl: string): string {
  const senderName = invitation.sender?.name || "Someone"
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Task Management Invitation</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { background-color: ${BRAND.accentColor}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; }
        .footer { margin-top: 30px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>You've been invited!</h2>
        <p><strong>${senderName}</strong> has invited you to collaborate on a task management workspace.</p>
        
        ${invitation.message ? `<p><em>"${invitation.message}"</em></p>` : ''}
        
        <p>Click the button below to accept the invitation:</p>
        
        <p>
          <a href="${inviteUrl}" class="button">Accept Invitation</a>
        </p>
        
        <p>Or copy and paste this link into your browser:</p>
        <p><a href="${inviteUrl}">${inviteUrl}</a></p>
        
        <div class="footer">
          <p>This invitation expires on ${invitation.expiresAt.toLocaleDateString()}.</p>
          <p>If you don't want to receive these emails, you can ignore this invitation.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

function getEmailText(invitation: Invitation, inviteUrl: string): string {
  const senderName = invitation.sender?.name || "Someone"
  
  return `
You've been invited!

${senderName} has invited you to collaborate on a task management workspace.

${invitation.message ? `Message: "${invitation.message}"` : ''}

Accept the invitation by visiting: ${inviteUrl}

This invitation expires on ${invitation.expiresAt.toLocaleDateString()}.

If you don't want to receive these emails, you can ignore this invitation.
  `.trim()
}

// ─── Feature access requests (task dd7172d8) ────────────────────────────────

interface FeatureAccessRequestData {
  featureKey: string
  useCase: string | null
  userEmail: string
  userName: string | null
}

/**
 * The use case is free text typed by a user and lands in an HTML email body,
 * so it must be escaped at the point of interpolation. Kept local rather than
 * imported from lib/markdown.ts, whose escapeHtml is module-private.
 */
function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Notify the product owner that someone asked for a gated feature.
 *
 * Recipient is env-configurable (FEATURE_REQUEST_EMAIL) so a whitelabel partner
 * routes requests to their own team. Throws on transport failure; the caller
 * decides whether that should fail the request (it should not — the row is the
 * durable artifact, the email is a convenience).
 */
export async function sendFeatureAccessRequestEmail(data: FeatureAccessRequestData) {
  const { featureRequestRecipient } = await import('./feature-access-requests')
  const to = featureRequestRecipient()
  const who = data.userName ? `${data.userName} <${data.userEmail}>` : data.userEmail
  const subject = `Feature request: ${data.featureKey} — ${data.userEmail}`

  const textBody = [
    `${who} requested access to "${data.featureKey}".`,
    '',
    data.useCase ? `Use case:\n${data.useCase}` : 'No use case given.',
    '',
    `Grant it in Admin → Feature rollouts by adding ${data.userEmail} to the Include list.`,
  ].join('\n')

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
      <h2 style="margin-bottom: 4px;">Feature request: ${escapeEmailHtml(data.featureKey)}</h2>
      <p style="color:#666; margin-top: 0;">${escapeEmailHtml(who)}</p>
      <div style="background-color:#f8fafc; border-left:4px solid ${BRAND.accentColor}; padding:16px; margin:16px 0; border-radius:4px;">
        ${data.useCase
          ? `<p style="margin:0;"><strong>Use case</strong></p><p style="margin:8px 0 0; white-space:pre-wrap;">${escapeEmailHtml(data.useCase)}</p>`
          : '<p style="margin:0; color:#666;">No use case given.</p>'}
      </div>
      <p>Grant it in <strong>Admin → Feature rollouts</strong> by adding
        <code>${escapeEmailHtml(data.userEmail)}</code> to the Include list.</p>
    </div>
  `.trim()

  if (process.env.NODE_ENV === 'development' || !resend || !process.env.RESEND_API_KEY) {
    log.info({ to, featureKey: data.featureKey, from: data.userEmail, useCase: data.useCase },
      '📧 Feature access request (Development Mode)')
    return
  }

  const { data: emailData, error } = await resend.emails.send({
    from: getFromEmail(),
    to: [to],
    subject,
    html: htmlBody,
    text: textBody,
  })

  if (error) {
    log.error({ err: error }, 'Resend error sending feature access request:')
    throw new Error(`Email sending failed: ${error.message}`)
  }

  log.info({ id: emailData?.id, featureKey: data.featureKey }, '📧 Feature access request email sent')
  return emailData
}
