import { Resend } from 'resend';

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  // Default matches docs/public/getting-started.md's documented RESEND_FROM_EMAIL
  // default. The old fallback, noreply@whiz-art.com, pointed at a Resend
  // domain deleted 2026-07-17 and would have silently failed to send.
  const FROM = process.env.RESEND_FROM_EMAIL ?? 'noreply@lumitra.co';
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Reset your password',
    html: `
      <p>You requested a password reset for your Analytics Platform account.</p>
      <p><a href="${resetUrl}">Click here to reset your password</a></p>
      <p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>
    `,
  });
}
