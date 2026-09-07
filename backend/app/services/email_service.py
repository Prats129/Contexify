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

        smtp_host = (settings.SMTP_HOST or "").strip()
        smtp_user = (settings.SMTP_USER or "").strip().strip('"').strip("'")
        smtp_password = (settings.SMTP_PASSWORD or "").strip().strip('"').strip("'")
        smtp_from_email = (settings.SMTP_FROM_EMAIL or smtp_user or "noreply@contexify.ai").strip().strip('"').strip("'")
        smtp_from_name = (settings.SMTP_FROM_NAME or "Contexify").strip().strip('"').strip("'")

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{smtp_from_name} <{smtp_from_email}>"
        msg["To"] = to_email

        part1 = MIMEText(text_content, "plain")
        part2 = MIMEText(html_content, "html")
        msg.attach(part1)
        msg.attach(part2)

        use_ssl = settings.SMTP_USE_SSL or (settings.SMTP_PORT == 465)
        primary_port = 465 if use_ssl else (settings.SMTP_PORT or 587)

        def _try_send(host: str, port: int, ssl_mode: bool) -> None:
            if ssl_mode:
                with smtplib.SMTP_SSL(host, port, timeout=12) as server:
                    if smtp_user and smtp_password:
                        server.login(smtp_user, smtp_password)
                    server.sendmail(smtp_from_email, [to_email], msg.as_string())
            else:
                with smtplib.SMTP(host, port, timeout=12) as server:
                    if settings.SMTP_USE_TLS:
                        server.starttls()
                    if smtp_user and smtp_password:
                        server.login(smtp_user, smtp_password)
                    server.sendmail(smtp_from_email, [to_email], msg.as_string())

        try:
            _try_send(smtp_host, primary_port, use_ssl)
            logger.info(f"Successfully sent email to '{to_email}' via SMTP {smtp_host}:{primary_port}")
            return True
        except Exception as primary_err:
            logger.warning(f"Primary SMTP attempt to {smtp_host}:{primary_port} (SSL={use_ssl}) failed: {primary_err}")
            # Cloud hosts frequently block port 587; retry via alternative port/mode (465 SSL vs 587 TLS)
            fallback_port = 465 if not use_ssl else 587
            fallback_ssl = not use_ssl
            try:
                logger.info(f"Retrying via fallback SMTP connection to {smtp_host}:{fallback_port} (SSL={fallback_ssl})...")
                _try_send(smtp_host, fallback_port, fallback_ssl)
                logger.info(f"Fallback SMTP dispatch to '{to_email}' succeeded via {smtp_host}:{fallback_port}")
                return True
            except Exception as fallback_err:
                logger.error(f"Both primary and fallback SMTP failed for '{to_email}'. Error: {fallback_err}", exc_info=True)
                return False

    def _generate_password_reset_html(self, display_name: str, otp_code: str, expiry_minutes: int) -> str:
        name_str = f" {display_name}" if display_name else ""
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Contexify Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0f172a; padding: 40px 15px;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" max-width="500" style="max-width: 500px; background-color: #1e293b; border-radius: 16px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 32px 32px 24px; text-align: center; background: linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(245, 158, 11, 0.15) 100%); border-bottom: 1px solid #334155;">
                            <div style="display: inline-block; padding: 8px 16px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 9999px; margin-bottom: 12px;">
                                <span style="color: #f87171; font-weight: 700; font-size: 14px; letter-spacing: 0.5px;">CONTEXIFY SECURITY</span>
                            </div>
                            <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff;">Password Reset Code</h1>
                        </td>
                    </tr>
                    <!-- Body -->
                    <tr>
                        <td style="padding: 32px;">
                            <p style="margin: 0 0 16px; font-size: 15px; line-height: 24px; color: #cbd5e1;">
                                Hello{name_str},
                            </p>
                            <p style="margin: 0 0 24px; font-size: 14px; line-height: 22px; color: #94a3b8;">
                                We received a request to reset the password for your Contexify account. Use the 6-digit verification code below to complete the reset. This code is valid for <strong>{expiry_minutes} minutes</strong>.
                            </p>
                            
                            <!-- OTP Box -->
                            <div style="background-color: #0f172a; border: 2px dashed #ef4444; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
                                <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #f87171; display: inline-block;">
                                    {otp_code}
                                </span>
                            </div>

                            <p style="margin: 24px 0 0; font-size: 13px; line-height: 20px; color: #64748b; text-align: center;">
                                If you did not request a password reset, please ignore this email or update your account security immediately.
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

    def _generate_password_reset_text(self, display_name: str, otp_code: str, expiry_minutes: int) -> str:
        name_str = f" {display_name}" if display_name else ""
        return (
            f"Hello{name_str},\n\n"
            f"Your Contexify password reset verification code is: {otp_code}\n\n"
            f"This code will expire in {expiry_minutes} minutes.\n"
            "If you did not request a password reset, please ignore this message.\n\n"
            "— The Contexify Team"
        )

    async def send_otp_email(self, to_email: str, otp_code: str, display_name: str = "") -> bool:
        """
        Send OTP verification code for login to the target email asynchronously.
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

    async def send_password_reset_otp_email(self, to_email: str, otp_code: str, display_name: str = "") -> bool:
        """
        Send OTP verification code for password reset to the target email asynchronously.
        """
        expiry_minutes = max(1, settings.OTP_EXPIRY_SECONDS // 60)
        subject = f"{otp_code} is your Contexify password reset code"
        text_content = self._generate_password_reset_text(display_name, otp_code, expiry_minutes)
        html_content = self._generate_password_reset_html(display_name, otp_code, expiry_minutes)

        return await asyncio.to_thread(
            self._send_smtp_sync,
            to_email,
            subject,
            text_content,
            html_content
        )

email_service = EmailService()
