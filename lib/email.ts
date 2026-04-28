// Email service implementation using Resend
import { Resend } from 'resend'
import { getBaseUrl } from './base-url'
import { createLogger } from '@/lib/logger'

const log = createLogger('email')


// Initialize Resend (only in server environment)
const resend = typeof window === 'undefined' && process.env.RESEND_API_KEY 
  ? new Resend(process.env.RESEND_API_KEY)
  : null

// Smart email configuration that works in both test and production
export function getFromEmail(): string {
  const configuredEmail = process.env.FROM_EMAIL
  const environment = process.env.NODE_ENV
  
  log.info(`📧 Email Configuration - Environment: ${environment}, Configured: ${configuredEmail}`)
  
  // In development, use configured email or fallback
  if (environment === "development") {
    const email = configuredEmail || 'noreply@yourdomain.com'
    log.info(`📧 Using development email: ${email}`)
    return email
  }
  
  // In production, if we have a configured email, use it (assuming domain is verified)
  if (configuredEmail) {
    log.info(`📧 Using configured email: ${configuredEmail}`)
    return configuredEmail
  }
  
  // If no configured email, fallback to Resend's verified test domain
  log.info(`📧 No FROM_EMAIL configured, falling back to: onboarding@resend.dev`)
  return 'onboarding@resend.dev'
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
        .button { background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; }
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
interface ListInvitationData {
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
        .button { background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; }
        .footer { margin-top: 30px; font-size: 12px; color: #666; }
        .list-info { background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 16px; margin: 16px 0; border-radius: 4px; }
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
        .button { background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; }
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
