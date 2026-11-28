import { routes } from "@/app/routers/routes";
import type { HelpArticle } from "../model/helpArticles";

export const helpArticles: HelpArticle[] = [
  {
    id: "account-session-help",
    title: "Resolve account and session problems",
    summary: "Recover from an expired session, a sign-in error, or an account that is temporarily locked.",
    roles: ["admin", "staff", "it"],
    category: "Account & Access",
    keywords: ["login", "password", "session", "locked account", "sign in"],
    commonIssue: true,
    sections: [
      { heading: "Problem", paragraphs: ["TANAW returns you to Sign In, rejects your password, or reports that the account is temporarily locked."] },
      { heading: "What to check", steps: ["Confirm that you are using your professional TANAW email.", "Check Caps Lock and try the password once more.", "If the account is locked, wait for the lock period shown on screen before trying again."] },
      { heading: "Steps to resolve", steps: ["Use Forgot Password on the Sign In page if you cannot remember the password.", "Complete the email verification steps.", "Sign in again and reopen the page you were using."] },
    ],
    relatedArticleIds: ["display-preferences"],
  },
  {
    id: "display-preferences",
    title: "Adjust text size",
    summary: "Make TANAW easier to read without changing your browser zoom or another user's display.",
    roles: ["admin", "staff", "it"],
    category: "Getting Started",
    keywords: ["large text", "font", "zoom", "accessibility", "display"],
    recommended: true,
    sections: [
      {
        heading: "Change your display",
        steps: ["Open your account menu.", "Choose General Settings, then Appearance.", "Select a Text size. The live preview shows the result, and each change saves immediately."],
      },
      { heading: "Return to the standard view", paragraphs: ["Choose Reset to default. Theme is a separate preference and is not changed by this action."] },
    ],
    relatedArticleIds: ["account-session-help"],
  },
  {
    id: "admin-map-navigation",
    title: "Navigate enterprises on the city map",
    summary: "Find an enterprise on the Dashboard map or in Registered Enterprises, understand pin colours, and open its details.",
    roles: ["admin"],
    category: "Map & Enterprises",
    keywords: ["map", "marker", "barangay", "enterprise", "camera status"],
    recommended: true,
    sections: [
      { heading: "Find an enterprise", steps: ["Open Dashboard and select a pin on the map. In a barangay with several enterprises, the map opens that barangay first.", "Select View details on the pin to open Enterprise Details.", "Or open Enterprise in the top bar, search or filter Registered Enterprises, and select View details."] },
      { heading: "What status means", paragraphs: ["Pin and camera status reflect the latest camera updates TANAW received. A ringed pin has more visitors than usual. Open Requests when a camera needs IT's help."] },
    ],
    relatedArticleIds: ["admin-operations-center"],
  },
  {
    id: "admin-operations-center",
    title: "Follow up a request in Requests",
    summary: "Review alerts, enterprise support requests and account changes, and send instructions to IT.",
    roles: ["admin"],
    category: "Requests",
    keywords: ["alert", "request", "operations", "monitoring", "issue"],
    commonIssue: true,
    sections: [
      { heading: "What to check", steps: ["Open Requests from Dashboard or the notification bell.", "Filter by type or progress, or search by location or reference number.", "Select a request to read what happened, its details and its latest updates."] },
      { heading: "Send instructions to IT", steps: ["Under Message IT, choose a quick instruction or write your own.", "Select Send to IT. IT is notified and your message is added to Latest updates."] },
    ],
    relatedArticleIds: ["admin-map-navigation"],
    supportPath: `${routes.admin.generalSettings}/support`,
  },
  {
    id: "staff-submit-reports",
    title: "Review submissions for a reporting period",
    summary: "Review establishment submissions and mark reports ready for consolidation.",
    roles: ["staff"],
    category: "Reports",
    keywords: ["reports", "reporting month", "review", "accept", "intake"],
    recommended: true,
    sections: [
      { heading: "Review submissions", steps: ["Open Reports and choose the reporting month.", "Select Review next to a report that is Reviewing.", "Check the VAR 2M form and the submission notes."] },
      { heading: "Record your decision", steps: ["Select Accept report to mark it Consolidated."] },
    ],
    relatedArticleIds: ["staff-final-reports"],
  },
  {
    id: "staff-final-reports",
    title: "Generate and download DOT reports",
    summary: "Generate the monthly VAR 2M in Reports and find monthly and annual forms in Consolidated Reports.",
    roles: ["staff"],
    category: "Reports",
    keywords: ["monthly report", "annual report", "consolidation", "VAR 2M", "VAR 3M"],
    sections: [
      { heading: "Generate a monthly report", steps: ["In Reports, choose the reporting month.", "Once every received report is consolidated, select Generate consolidated report. Enterprises that have not sent a report are left out.", "Review the VAR 2M, finalize it for the annual report, then select Download PDF or Print."] },
      { heading: "Find a monthly report", steps: ["Open Consolidated Reports and choose the year.", "Select View to open a month's VAR 2M, then Download PDF or Print."] },
      { heading: "Download the annual report", steps: ["In Consolidated Reports, open Annual (VAR 3M).", "Select View for the year you need, then Download PDF or Print."] },
    ],
    relatedArticleIds: ["staff-submit-reports"],
  },
  {
    id: "it-requests",
    title: "Handle a request in Requests",
    summary: "Pick up a request with Start on it, reply to the sender, approve or decline an account change, and resolve, reopen or move a request.",
    roles: ["it"],
    category: "Requests",
    keywords: ["request", "requests waiting for IT", "start on it", "not picked up", "account change", "reply", "resolve", "reopen", "move"],
    recommended: true,
    commonIssue: true,
    sections: [
      {
        heading: "Find the request",
        steps: [
          "Requests opens when you sign in. The amber count beside it in the top bar is the number of open requests nobody has picked up.",
          "Search, or filter by Type and Status. Status shows Open requests first; choose Not picked up to see the ones waiting for IT. Select Clear filters to see every request again.",
          "Select a row to open the request's details, the conversation and its updates beside the table. Select Close, or press Escape, to give the table its full width again.",
        ],
      },
      {
        heading: "Take and answer it",
        steps: [
          "Select Start on it on the request's row, or in its details. It is then yours, and the sender sees who is handling it. Replying, resolving or moving a request nobody has picked up also makes it yours.",
          "Write a reply or choose a quick reply, then select Send reply, or Send and mark resolved when the problem is fixed.",
          "Select Mark resolved, Reopen or Move to another type when the request needs it.",
        ],
      },
      {
        heading: "Decide an account change",
        paragraphs: ["An account change shows what the value is now and what was asked for. Select Approve change to apply it, or Decline to keep the old value; write the reason in the reply first. A new email address must be verified before you can approve it."],
      },
    ],
    relatedArticleIds: ["it-enterprises", "it-personnel"],
  },
  {
    id: "it-enterprises",
    title: "Register and manage an enterprise",
    summary: "Register an enterprise, send its owner's invitation again, and check its desktop app, cameras, details and opening hours.",
    roles: ["it"],
    category: "Enterprises",
    keywords: ["enterprise", "register", "invitation", "desktop app", "cameras", "manage", "opening hours", "password reset", "deactivate"],
    sections: [
      {
        heading: "Register an enterprise",
        steps: [
          "Open Enterprises and select Register enterprise.",
          "Enter the name, attraction type, address and map pin, barangay, owner, contact number, capacity, email and opening hours.",
          "Select Register and send invitation. The owner gets an email to set a password and install the desktop app.",
        ],
      },
      {
        heading: "Find an enterprise",
        paragraphs: ["Use the Show chips (All, Needs attention, Invitation pending, Sending data) or search. Select Send again or Send a new link when an owner has not accepted the invitation."],
      },
      {
        heading: "Manage an enterprise",
        steps: [
          "Select Manage beside the enterprise.",
          "Connection shows the desktop app, today's camera strip and the requests from this place. Use Send a notice to message the enterprise.",
          "Details and account edits the details (Save details), sends a password reset email, and deactivates or activates the enterprise after you confirm.",
          "Opening hours saves the weekly hours (Save hours) and adds or removes closed days.",
        ],
      },
    ],
    relatedArticleIds: ["it-requests", "it-account-troubleshooting"],
  },
  {
    id: "it-personnel",
    title: "Invite and manage LGU Personnel",
    summary: "Invite Admin, Staff and IT accounts, approve a new sign-in email, change a role, and turn access off when someone leaves.",
    roles: ["it"],
    category: "LGU Personnel",
    keywords: ["lgu personnel", "invite", "account", "role", "email change", "deactivate", "activate"],
    sections: [
      {
        heading: "Invite someone",
        steps: ["Open LGU Personnel and select Invite personnel.", "Enter the name and work email, add a phone number if you have one, and choose a role.", "Select Send invitation. The person gets a link to set a password."],
      },
      {
        heading: "Look after an account",
        steps: [
          "Search, filter by role, or select Show deactivated accounts.",
          "Use Edit, Send invitation again, Deactivate or Activate on the person's row. Deactivating asks you to confirm.",
          "When someone asks for a new sign-in email, select Approve or Decline in the callout. Another IT account has to approve a change you asked for or one on your own account.",
        ],
      },
    ],
    relatedArticleIds: ["it-account-troubleshooting"],
  },
  {
    id: "it-system-settings",
    title: "Change system settings",
    summary: "Set the sign-in lockout, the camera wait, how long activity is kept, and the date and time format in System, then save them together.",
    roles: ["it"],
    category: "System",
    keywords: ["system settings", "settings", "lockout", "camera", "retention", "date format", "time format"],
    commonIssue: true,
    sections: [
      {
        heading: "Change settings",
        steps: [
          "Open System and choose the Settings tab.",
          "Change Sign-in lockout, Camera not counting, Keep activity for, or Date and time. The date format and time format apply to every account and to exported reports.",
          "Select Save settings to save every change at once, or Discard to undo them. A sign-in lockout change asks you to confirm because it affects every account.",
        ],
      },
      {
        heading: "Remove older activity",
        paragraphs: ["Under Keep activity for, select Remove older activity now to permanently delete activity older than the period you keep. TANAW asks you to confirm, and the line above the button says when the last cleanup ran and how many entries it removed."],
      },
    ],
    relatedArticleIds: ["it-system-activity"],
  },
  {
    id: "it-system-activity",
    title: "Trace an event in Activity and the Email log",
    summary: "Find who did what and when in System, with the technical detail IT needs, and send an email that did not arrive again.",
    roles: ["it"],
    category: "System",
    keywords: ["activity", "email log", "technical detail", "ip address", "browser", "session", "try again", "delivery"],
    sections: [
      {
        heading: "Activity",
        steps: [
          "Open System. The Activity tab lists every event, newest first.",
          "Choose a type: All, Sign-in and security, Requests, Accounts, Enterprises or System.",
          "Expand a row to see its technical detail, such as the IP address, browser and session.",
        ],
      },
      {
        heading: "Email log",
        steps: ["Choose the Email log tab. The count beside it is the number of emails that did not arrive.", "Switch between All emails and Problems only to see the last 7 days.", "Select Try again on an email that failed."],
      },
    ],
    relatedArticleIds: ["it-system-settings", "it-account-troubleshooting"],
  },
  {
    id: "it-account-troubleshooting",
    title: "Troubleshoot an account access issue",
    summary: "Check account state, invitations and lockouts without bypassing TANAW authorization.",
    roles: ["it"],
    category: "Account & Access",
    keywords: ["account", "invitation", "activation", "locked", "inactive", "email", "password reset"],
    sections: [
      {
        heading: "What to check",
        steps: [
          "Open LGU Personnel for an Admin, Staff or IT account, or Enterprises for an enterprise account.",
          "Confirm the account's access and email, and whether its invitation is still waiting or has expired.",
          "In System, check Activity under Sign-in and security for a lockout, and the Email log for an invitation or reset email that did not arrive.",
        ],
      },
      {
        heading: "Steps to resolve",
        paragraphs: ["Use the actions TANAW offers for that state: Send invitation again, Send a new link, or Send a password reset email for an enterprise. Do not share passwords or bypass role access."],
      },
    ],
    relatedArticleIds: ["account-session-help", "it-personnel", "it-system-activity"],
  },
];
