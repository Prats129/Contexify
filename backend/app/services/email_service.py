import smtplib
import asyncio
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import settings
from app.core.logging import logger

class EmailService:
    """
    Email service for sending OTPs, transactional notifications,
    and alerts via SMTP with HTML/Text formatting.
    """

    def _generate_otp_html(self, display_name: str, otp_code: str, expiry_minutes: int) -> str:
        name_str = f" {display_name}" if display_name else ""
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Contexify Login Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0f172a; padding: 40px 15px;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" max-width="500" style="max-width: 500px; background-color: #1e293b; border-radius: 16px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 32px 32px 24px; text-align: center; background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%); border-bottom: 1px solid #334155;">
                            <div style="display: inline-block; padding: 8px 16px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 9999px; margin-bottom: 12px;">
                                <span style="color: #60a5fa; font-weight: 700; font-size: 14px; letter-spacing: 0.5px;">CONTEXIFY AI</span>
                            </div>
                            <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff;">Login Verification Code</h1>
                        </td>
                    </tr>
                    <!-- Body -->
                    <tr>
                        <td style="padding: 32px;">
                            <p style="margin: 0 0 16px; font-size: 15px; line-height: 24px; color: #cbd5e1;">
                                Hello{name_str},
                            </p>
                            <p style="margin: 0 0 24px; font-size: 14px; line-height: 22px; color: #94a3b8;">
                                Use the following One-Time Password (OTP) to securely sign in to your Contexify account. This code is valid for <strong>{expiry_minutes} minutes</strong>.
                            </p>
                            
                            <!-- OTP Box -->
                            <div style="background-color: #0f172a; border: 2px dashed #3b82f6; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
                                <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #38bdf8; display: inline-block;">
                                    {otp_code}
                                </span>
                            </div>

                            <p style="margin: 24px 0 0; font-size: 13px; line-height: 20px; color: #64748b; text-align: center;">
                                If you did not request this login code, you can safely ignore this email. Someone may have entered your email address by mistake.
                            </p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 20px 32px; background-color: #0b1120; border-top: 1px solid #1e293b; text-align: center;">
                            <p style="margin: 0; font-size: 12px; color: #475569;">
                                &copy; Contexify AI &bull; Enterprise RAG &amp; Web Search Engine
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>"""

    def _generate_otp_text(self, display_name: str, otp_code: str, expiry_minutes: int) -> str:
        name_str = f" {display_name}" if display_name else ""
        return (
            f"Hello{name_str},\n\n"
            f"Your Contexify login verification code is: {otp_code}\n\n"
            f"This code will expire in {expiry_minutes} minutes.\n"
            "If you did not request this code, please ignore this message.\n\n"
            "— The Contexify Team"
        )

    def _send_smtp_sync(self, to_email: str, subject: str, text_content: str, html_content: str) -> bool:
        """Synchronous SMTP email delivery."""
        if not settings.SMTP_HOST:
            logger.info(
                f"[DEV MODE / NO SMTP] Email to '{to_email}' skipped SMTP dispatch.\n"
                f"Subject: {subject}\n"
                f"Body: {text_content}"
            )
            return True

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
        msg["To"] = to_email

        part1 = MIMEText(text_content, "plain")
        part2 = MIMEText(html_content, "html")
        msg.attach(part1)
        msg.attach(part2)

        try:
            if settings.SMTP_USE_SSL:
                with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
                    if settings.SMTP_USER and settings.SMTP_PASSWORD:
                        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                    server.sendmail(settings.SMTP_FROM_EMAIL, [to_email], msg.as_string())
            else:
                with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
                    if settings.SMTP_USE_TLS:
                        server.starttls()
                    if settings.SMTP_USER and settings.SMTP_PASSWORD:
                        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                    server.sendmail(settings.SMTP_FROM_EMAIL, [to_email], msg.as_string())

            logger.info(f"Successfully sent email to '{to_email}' via SMTP {settings.SMTP_HOST}:{settings.SMTP_PORT}")
            return True
        except Exception as e:
            logger.error(f"Failed to send email to '{to_email}' via SMTP: {e}", exc_info=True)
            # In development or if SMTP fails, do not crash the auth flow
            return False

    async def send_otp_email(self, to_email: str, otp_code: str, display_name: str = "") -> bool:
        """
        Send OTP verification code to the target email asynchronously.
        """
        expiry_minutes = max(1, settings.OTP_EXPIRY_SECONDS // 60)
        subject = f"{otp_code} is your Contexify login code"
        text_content = self._generate_otp_text(display_name, otp_code, expiry_minutes)
        html_content = self._generate_otp_html(display_name, otp_code, expiry_minutes)

        return await asyncio.to_thread(
            self._send_smtp_sync,
            to_email,
            subject,
            text_content,
            html_content
        )

email_service = EmailService()
