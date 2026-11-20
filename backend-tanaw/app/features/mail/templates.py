from dataclasses import dataclass
from html import escape
from urllib.parse import urljoin

from app.features.accounts.models import Account, AccountRole

# Serve the portal's official eagle independently of the portal deployment.
_PORTAL_LOGO_URL = (
    "https://cdn.jsdelivr.net/gh/ggervzsss/TANAW@0bce8584a387f61c7410222ce3a2a90c8d2bcb32"
    "/frontend-tanaw/public/apple-touch-icon.png"
)


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
    sign_in_hint = ""
    sign_in_fields: tuple[tuple[str, str], ...]
    if account.role == AccountRole.ENTERPRISE and account.enterprise_id:
        sign_in_fields = (
            ("Enterprise ID", account.enterprise_id),
            ("Contact email", account.email),
        )
        sign_in_hint = "You may sign in with either your Enterprise ID or contact email."
    else:
        sign_in_fields = (("Username", account.email),)
    login_lines = "\n".join(f"{label}: {value}" for label, value in sign_in_fields)
    if sign_in_hint:
        login_lines = f"{login_lines}\n{sign_in_hint}"
    text = (
        f"Hello {account.display_name},\n\n"
        "Your TANAW account has been created.\n"
        f"{login_lines}\n"
        "Choose your password and activate your account using this secure link:\n"
        f"{activation_url}\n\n"
        f"This single-use link expires at {expires_label}.\n"
        "If you did not expect this account, use Contact Support on the TANAW sign-in page."
    )
    html = _account_activation_html(
        account.display_name, activation_url, expires_label, sign_in_fields, sign_in_hint
    )
    return EmailContent(subject="Activate your TANAW account", text=text, html=html)


def _account_activation_html(
    display_name: str,
    activation_url: str,
    expires_label: str,
    sign_in_fields: tuple[tuple[str, str], ...],
    sign_in_hint: str,
) -> str:
    sign_in_url = escape(urljoin(activation_url, "login"))
    details = "".join(
        f"""<tr><td style="padding:8px 0 0;">
          <p class="secondary" style="margin:0;color:#475569;font-size:13px;font-weight:700;line-height:20px;">{escape(label)}</p>
          <p class="ink" style="margin:0;color:#10241b;font-size:15px;line-height:22px;word-wrap:break-word;overflow-wrap:anywhere;">{escape(value).replace("@", "<wbr>@", 1)}</p>
        </td></tr>"""
        for label, value in sign_in_fields
    )
    hint = (
        f'<p class="secondary" style="margin:12px 0 0;color:#475569;font-size:13px;line-height:20px;">'
        f"{escape(sign_in_hint)}</p>"
        if sign_in_hint
        else ""
    )
    body = f"""
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
            <tr><td bgcolor="#eef7f1" class="tint line" style="padding:15px 17px;border:1px solid #c6d6cb;border-radius:10px;">
              <h2 class="brand" style="margin:0 0 4px;color:#065f46;font-size:15px;line-height:22px;">Your sign-in details</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
                {details}
              </table>
              {hint}
            </td></tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="224" class="action" style="width:224px;">
            <tr><td height="22" style="font-size:1px;line-height:22px;mso-line-height-rule:exactly;">&nbsp;</td></tr>
            <tr><td align="center" bgcolor="#055b25" style="background-color:#055b25;border-radius:8px;mso-padding-alt:14px 16px;">
              <a href="{escape(activation_url)}" style="display:block;padding:14px 16px;mso-padding-alt:0;
                color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:16px;line-height:20px;
                text-decoration:none;">Activate Account</a>
            </td></tr>
          </table>
          <p class="secondary" style="margin:12px 0 0;color:#475569;font-size:13px;line-height:20px;">
            This single-use link expires on <strong class="ink" style="color:#10241b;">{escape(expires_label)}</strong>.
          </p>"""
    footer = (
        "If you weren’t expecting this account, use Contact Support on the "
        f'<a href="{sign_in_url}" class="brand" style="color:#065f46;text-decoration:underline;">TANAW sign-in page</a>.'
    )
    return _portal_layout(
        title="Activate your TANAW account",
        display_name=display_name,
        introduction="Your TANAW account is ready. Choose a password to finish setting it up.",
        body=body,
        footer=footer,
    )


def _portal_layout(
    *, title: str, display_name: str, introduction: str, body: str, footer: str
) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>{escape(title)}</title>
  <style>
    :root {{ color-scheme:light dark; supported-color-schemes:light dark; }}
    .masthead {{ background-image:linear-gradient(90deg,#043817 0%,#075526 44%,#0c6a32 100%); }}
    @media screen and (max-width:480px) {{
      .frame {{ padding:16px 10px !important; }}
      .inset {{ padding-left:20px !important; padding-right:20px !important; }}
      .heading {{ font-size:25px !important; line-height:32px !important; }}
      .action {{ width:100% !important; }}
    }}
    @media (prefers-color-scheme:dark) {{
      .canvas {{ background-color:#101923 !important; }}
      .sheet {{ background-color:#151f2b !important; }}
      .line {{ border-color:#334252 !important; }}
      .tint {{ background-color:#17302b !important; }}
      .footer {{ background-color:#111b25 !important; }}
      .ink {{ color:#f1f5f4 !important; }}
      .secondary {{ color:#b8c2cb !important; }}
      .brand {{ color:#6ee7b7 !important; }}
    }}
  </style>
  <style>
    /* Gmail iOS can recolor the brand text while leaving the gradient intact. */
    u + .email-body .gmail-screen {{ background:#000000; mix-blend-mode:screen; }}
    u + .email-body .gmail-difference {{ background:#000000; mix-blend-mode:difference; }}
  </style>
</head>
<body class="email-body canvas" style="margin:0;padding:0;background-color:#f0f5f1;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0f5f1" class="canvas">
    <tr><td class="frame" align="center" style="padding:32px 16px;">
      <!--[if mso]><table role="presentation" width="580" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        class="card" style="max-width:580px;table-layout:fixed;font-family:Arial,Helvetica,sans-serif;mso-table-lspace:0pt;mso-table-rspace:0pt;">
        <tr><td bgcolor="#075526" class="masthead inset" style="padding:17px 32px;background-color:#075526;border-radius:16px 16px 0 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="54" valign="middle" style="padding-right:14px;">
                <img src="{_PORTAL_LOGO_URL}" width="54" height="54" alt="TANAW eagle logo"
                  style="display:block;border:0;color:#ffffff;font:11px Arial,Helvetica,sans-serif;">
              </td>
              <td valign="middle" style="font-family:Arial,Helvetica,sans-serif;">
                <div class="gmail-screen"><div class="gmail-difference" style="color:#ffffff;">
                  <p style="margin:0;color:#ffffff;font-size:25px;font-weight:700;line-height:28px;">TANAW</p>
                  <p style="margin:2px 0 0;color:#ffffff;font-size:10px;font-weight:700;letter-spacing:3px;line-height:14px;">PORTAL</p>
                </div></div>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td height="4" bgcolor="#5a8c46" class="thread" style="height:4px;background-color:#5a8c46;
          background-image:linear-gradient(90deg,#1b4332 0%,#c5a047 50%,#5a8c46 100%);
          font-size:1px;line-height:4px;mso-line-height-rule:exactly;">&nbsp;</td></tr>
        <tr><td bgcolor="#ffffff" class="sheet inset line" style="padding:28px 32px;border:1px solid #d6e2d9;border-top:0;border-bottom:0;">
          <h1 class="heading ink" style="margin:0 0 14px;color:#10241b;font-size:29px;line-height:36px;">{escape(title)}</h1>
          <p class="ink" style="margin:0 0 6px;color:#10241b;font-size:16px;line-height:24px;word-wrap:break-word;overflow-wrap:anywhere;">Hello <strong>{escape(display_name)}</strong>,</p>
          <p class="secondary" style="margin:0 0 20px;color:#475569;font-size:15px;line-height:23px;">{escape(introduction)}</p>
          {body}
        </td></tr>
        <tr><td bgcolor="#f8faf9" class="footer inset line" style="padding:17px 32px 20px;border:1px solid #d6e2d9;border-radius:0 0 16px 16px;">
          <p class="brand" style="margin:0 0 5px;color:#065f46;font-size:13px;font-weight:700;line-height:20px;">TANAW Portal</p>
          <p class="secondary" style="margin:0;color:#475569;font-size:13px;line-height:20px;">{footer}</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>"""


def password_reset_code_email(
    account: Account | EmailRecipient, code: str, expires_label: str
) -> EmailContent:
    introduction = "Enter this verification code on the TANAW password reset screen to choose a new password for your account."
    security_reminder = (
        "Keep this code private. If you didn’t request a password reset, ignore this email "
        "or use Contact Support on the TANAW sign-in page."
    )
    text = (
        f"Hello {account.display_name},\n\n"
        f"{introduction}\n\n"
        f"Verification code: {code}\n\n"
        f"This one-time code expires on {expires_label}.\n\n"
        f"{security_reminder}"
    )
    body = f"""
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" bgcolor="#eef7f1" class="tint line" style="padding:18px 12px;border:1px solid #c6d6cb;border-radius:10px;">
              <h2 class="brand" style="margin:0 0 7px;color:#065f46;font-size:15px;line-height:22px;">Verification code</h2>
              <p class="ink" style="margin:0;color:#10241b;font-family:Consolas,'Courier New',monospace;font-size:34px;font-weight:700;line-height:42px;letter-spacing:5px;white-space:nowrap;user-select:all;">{escape(code)}</p>
            </td></tr>
          </table>
          <p class="secondary" style="margin:16px 0 0;color:#475569;font-size:13px;line-height:20px;">
            This one-time code expires on <strong class="ink" style="color:#10241b;">{escape(expires_label)}</strong>.
          </p>"""
    html = _portal_layout(
        title="Reset your TANAW password",
        display_name=account.display_name,
        introduction=introduction,
        body=body,
        footer=escape(security_reminder),
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


def business_email_change_email(account: Account | EmailRecipient, new_email: str) -> EmailContent:
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
    account: Account | EmailRecipient,
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
    account: Account | EmailRecipient,
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
    account: Account | EmailRecipient,
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
code{{font-size:18px}}pre{{white-space:pre-wrap;font:15px Arial,sans-serif}}.muted{{color:#64748b;font-size:14px}}
.button{{display:inline-block;background:#0f766e;color:#fff!important;text-decoration:none;font-weight:700;border-radius:8px;padding:13px 20px}}
</style></head><body><div class="wrap"><div class="panel"><h1>{escape(title)}</h1>{body}</div></div></body></html>"""
