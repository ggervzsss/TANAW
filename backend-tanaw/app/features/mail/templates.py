from dataclasses import dataclass
from html import escape

from app.features.accounts.models import AccountRole


@dataclass(frozen=True)
class EmailContent:
    subject: str
    text: str
    html: str


@dataclass(frozen=True)
class EmailRecipient:
    display_name: str
    email: str
    role: AccountRole
    enterprise_id: str | None = None


def account_activation_email(
    account: EmailRecipient, activation_url: str, expires_label: str
) -> EmailContent:
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
        "Choose your password and activate your account using this secure link:\n"
        f"{activation_url}\n\n"
        f"This single-use link expires at {expires_label}.\n"
        "If you did not expect this account, use Contact Support on the TANAW sign-in page."
    )
    html = _layout(
        "Activate your TANAW account",
        f"""
        <p>Hello {escape(account.display_name)},</p>
        <p>Your TANAW account has been created.</p>
        <div class="card"><pre>{escape(login_lines)}</pre></div>
        <p>Choose your password and activate your account:</p>
        <p><a class="button" href="{escape(activation_url, quote=True)}">Activate account</a></p>
        <p>This single-use link expires at <strong>{escape(expires_label)}</strong>.</p>
        <p class="muted">If you did not expect this account, use Contact Support on the TANAW sign-in page.</p>
        """,
    )
    return EmailContent(subject="Activate your TANAW account", text=text, html=html)


def password_reset_code_email(
    account: EmailRecipient, code: str, expires_label: str
) -> EmailContent:
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


def business_email_change_email(account: EmailRecipient, new_email: str) -> EmailContent:
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


def account_email_change_verification_email(
    account: EmailRecipient,
    *,
    old_email: str,
    new_email: str,
    verification_url: str,
    expires_label: str,
) -> EmailContent:
    text = (
        f"Hello {account.display_name},\n\n"
        "Confirm that you own this proposed TANAW account email address.\n"
        f"Current email: {old_email}\n"
        f"Proposed email: {new_email}\n"
        f"Verify ownership: {verification_url}\n\n"
        f"This single-use link expires at {expires_label}. IT cannot apply the change until "
        "ownership is verified. If you did not request this, do not open the link and contact "
        "TANAW support."
    )
    html = _layout(
        "Verify your proposed TANAW email",
        f"""
        <p>Hello {escape(account.display_name)},</p>
        <p>Confirm that you own this proposed TANAW account email address.</p>
        <div class="card"><p><strong>Current email:</strong> {escape(old_email)}</p><p><strong>Proposed email:</strong> {escape(new_email)}</p></div>
        <p><a class="button" href="{escape(verification_url, quote=True)}">Verify email ownership</a></p>
        <p>This single-use link expires at <strong>{escape(expires_label)}</strong>. IT cannot apply the change until ownership is verified.</p>
        <p class="muted">If you did not request this, do not open the link and contact TANAW support.</p>
        """,
    )
    return EmailContent(
        subject="Verify your proposed TANAW email address",
        text=text,
        html=html,
    )


def account_email_change_request_notice_email(
    account: EmailRecipient,
    *,
    new_email: str,
    expires_label: str,
) -> EmailContent:
    text = (
        f"Hello {account.display_name},\n\n"
        f"A request was made to change your TANAW account email to {new_email}. "
        f"The proposed address must be verified before {expires_label}, and TANAW IT must "
        "approve it before your sign-in or recovery email changes.\n\n"
        "If you did not request this, contact TANAW support immediately. Your current email "
        "remains active until approval."
    )
    html = _layout(
        "TANAW email change requested",
        f"""
        <p>Hello {escape(account.display_name)},</p>
        <p>A request was made to change your TANAW account email to <strong>{escape(new_email)}</strong>.</p>
        <p>The proposed address must be verified before <strong>{escape(expires_label)}</strong>, and TANAW IT must approve it before your sign-in or recovery email changes.</p>
        <p class="muted">If you did not request this, contact TANAW support immediately. Your current email remains active until approval.</p>
        """,
    )
    return EmailContent(subject="TANAW account email change requested", text=text, html=html)


def account_email_change_approved_email(
    account: EmailRecipient,
    *,
    old_email: str,
    new_email: str,
    sent_to_old_address: bool,
) -> EmailContent:
    destination_note = (
        "This notice was sent to your previous address for security."
        if sent_to_old_address
        else "This is now the registered email for TANAW sign-in and password recovery."
    )
    text = (
        f"Hello {account.display_name},\n\n"
        "TANAW IT approved the account email change.\n"
        f"Previous email: {old_email}\n"
        f"New email: {new_email}\n\n"
        f"{destination_note}\n"
        "All earlier sessions and password-recovery challenges were invalidated."
    )
    html = _layout(
        "TANAW account email changed",
        f"""
        <p>Hello {escape(account.display_name)},</p>
        <p>TANAW IT approved the account email change.</p>
        <div class="card"><p><strong>Previous email:</strong> {escape(old_email)}</p><p><strong>New email:</strong> {escape(new_email)}</p></div>
        <p>{escape(destination_note)}</p>
        <p class="muted">All earlier sessions and password-recovery challenges were invalidated.</p>
        """,
    )
    return EmailContent(subject="Your TANAW account email was changed", text=text, html=html)


def _layout(title: str, body: str) -> str:
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
body{{margin:0;background:#f1f5f9;color:#0f172a;font:16px Arial,sans-serif}}
.wrap{{max-width:620px;margin:0 auto;padding:32px 20px}}.panel{{background:#fff;border-radius:14px;padding:30px}}
h1{{font-size:24px;margin:0 0 24px}}p{{line-height:1.6}}.card{{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px}}
.code{{font:700 32px monospace;letter-spacing:8px;text-align:center;background:#ecfeff;border-radius:10px;padding:18px}}
code{{font-size:18px}}pre{{white-space:pre-wrap;font:15px Arial,sans-serif}}.muted{{color:#64748b;font-size:14px}}
.button{{display:inline-block;background:#0f766e;color:#fff!important;text-decoration:none;font-weight:700;border-radius:8px;padding:13px 20px}}
</style></head><body><div class="wrap"><div class="panel"><h1>{escape(title)}</h1>{body}</div></div></body></html>"""
