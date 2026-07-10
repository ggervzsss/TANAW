from dataclasses import dataclass
from html import escape

from app.features.accounts.models import Account, AccountRole


@dataclass(frozen=True)
class EmailContent:
    subject: str
    text: str
    html: str


def onboarding_email(account: Account, temporary_password: str) -> EmailContent:
    if account.role == AccountRole.ENTERPRISE and account.enterprise_id:
        login_lines = (
            f"Enterprise ID: {account.enterprise_id}\n"
            f"Contact email: {account.email}\n"
            "You may sign in with either your Enterprise ID or contact email."
        )
    else:
        login_lines = f"Username: {account.email}"
    text = (
        f"Hello {account.display_name},\n\n"
        "Your TANAW account has been created.\n"
        f"{login_lines}\n"
        f"Temporary password: {temporary_password}\n\n"
        "This temporary password expires in 7 days. You must change it on first login.\n"
        "If you did not expect this account, use Contact Support on the TANAW sign-in page."
    )
    html = _layout(
        "Your TANAW account is ready",
        f"""
        <p>Hello {escape(account.display_name)},</p>
        <p>Your TANAW account has been created.</p>
        <div class="card"><pre>{escape(login_lines)}</pre>
        <p><strong>Temporary password:</strong> <code>{escape(temporary_password)}</code></p></div>
        <p>This temporary password expires in 7 days. You must change it on first login.</p>
        <p class="muted">If you did not expect this account, use Contact Support on the TANAW sign-in page.</p>
        """,
    )
    return EmailContent(subject="Your TANAW account credentials", text=text, html=html)


def password_reset_code_email(account: Account, code: str, expires_label: str) -> EmailContent:
    text = (
        f"Hello {account.display_name},\n\n"
        "A TANAW password reset was requested for your account.\n"
        f"Verification code: {code}\n"
        f"This code expires at {expires_label} and can be used once.\n\n"
        "If you did not request this reset, use Contact Support on the TANAW sign-in page."
    )
    html = _layout(
        "TANAW password reset",
        f"""
        <p>Hello {escape(account.display_name)},</p>
        <p>A TANAW password reset was requested for your account.</p>
        <div class="code">{escape(code)}</div>
        <p>This one-time code expires at <strong>{escape(expires_label)}</strong>.</p>
        <p class="muted">If you did not request this reset, use Contact Support on the TANAW sign-in page.</p>
        """,
    )
    return EmailContent(subject="TANAW password reset verification code", text=text, html=html)


def support_ticket_reply_email(
    *, ticket_code: str, subject: str, recipient_name: str, author_name: str, message: str
) -> EmailContent:
    email_subject = f"[{ticket_code}] Re: {subject}"
    text = (
        f"Hello {recipient_name},\n\n"
        f"{author_name} replied to your TANAW support ticket {ticket_code}:\n\n"
        f"{message}\n\n"
        "Open Support Tickets in TANAW to view and continue the conversation."
    )
    html = _layout(
        f"Support ticket {escape(ticket_code)}",
        f"""
        <p>Hello {escape(recipient_name)},</p>
        <p><strong>{escape(author_name)}</strong> replied to your TANAW support ticket.</p>
        <div class="card"><p>{escape(message)}</p></div>
        <p class="muted">Open Support Tickets in TANAW to view and continue the conversation.</p>
        """,
    )
    return EmailContent(subject=email_subject, text=text, html=html)


def business_email_change_email(account: Account, new_email: str) -> EmailContent:
    text = (
        f"Hello {account.display_name},\n\n"
        "A request was submitted to change the TANAW business email for your account "
        f"to {new_email}. TANAW IT and Admin will review the request.\n\n"
        "If you did not request this change, submit a support request through TANAW immediately."
    )
    html = _layout(
        "TANAW business email change request",
        f"""
        <p>Hello {escape(account.display_name)},</p>
        <p>A request was submitted to change the TANAW business email for your account to <strong>{escape(new_email)}</strong>.</p>
        <p>TANAW IT and Admin will review the request.</p>
        <p class="muted">If you did not request this change, submit a support request through TANAW immediately.</p>
        """,
    )
    return EmailContent(subject="TANAW business email change request", text=text, html=html)


def _layout(title: str, body: str) -> str:
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
body{{margin:0;background:#f1f5f9;color:#0f172a;font:16px Arial,sans-serif}}
.wrap{{max-width:620px;margin:0 auto;padding:32px 20px}}.panel{{background:#fff;border-radius:14px;padding:30px}}
h1{{font-size:24px;margin:0 0 24px}}p{{line-height:1.6}}.card{{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px}}
.code{{font:700 32px monospace;letter-spacing:8px;text-align:center;background:#ecfeff;border-radius:10px;padding:18px}}
code{{font-size:18px}}pre{{white-space:pre-wrap;font:15px Arial,sans-serif}}.muted{{color:#64748b;font-size:14px}}
</style></head><body><div class="wrap"><div class="panel"><h1>{escape(title)}</h1>{body}</div></div></body></html>"""
