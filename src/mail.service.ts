import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

type Attachment = { filename: string; path: string };

/** Notification emails to the company inbox. Never throws: the form data is already saved. */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private readonly port = Number(process.env.SMTP_PORT ?? 465);
  private readonly transport = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: this.port,
        secure: this.port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })
    : null;

  canSendPortalMail() {
    return Boolean(this.transport && (process.env.SMTP_FROM || process.env.SMTP_USER));
  }

  async sendPortalLink(to: string, url: string) {
    if (!this.transport || !this.canSendPortalMail()) throw new Error('Portal mail is not configured.');
    await this.transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: 'Sign in to the Nova Sitara Employee Portal',
      text: `Open this single-use link to sign in. It expires in 15 minutes.\n\n${url}\n\nIf you did not request it, ignore this message. Do not forward your sign-in link.`,
    });
  }

  async notify(subject: string, fields: Record<string, string | null | undefined>, replyTo?: string, attachments: Attachment[] = []) {
    if (!this.transport || !process.env.MAIL_TO) {
      this.log.warn(`SMTP_HOST or MAIL_TO not set, skipped email: ${subject}`);
      return;
    }
    const text = Object.entries(fields)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}:\n${v}\n`)
      .join('\n');
    try {
      await this.transport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: process.env.MAIL_TO,
        replyTo,
        subject: subject.replace(/[\r\n]+/g, ' '),
        text,
        attachments,
      });
    } catch (e) {
      this.log.error(`Email failed: ${subject}`, e instanceof Error ? e.stack : String(e));
    }
  }
}
