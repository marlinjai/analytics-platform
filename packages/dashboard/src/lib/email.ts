import { Resend } from 'resend';

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const FROM = process.env.RESEND_FROM_EMAIL ?? 'noreply@whiz-art.com';
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
