# Activity, Requests And Alerts

This document describes how TANAW should record what happens, take requests
for help, and warn people about live problems. It replaces the earlier review
list of every activity and request type, and it is based on that review of the
`new-ui` branch.

- Status: proposed design, agreed in discussion on November 24, 2026.
  Not implemented yet.
- Applies to: the Admin portal, the IT portal and the desktop app.

## Overview

TANAW uses three places, and each one has a single job.

| Place | Job | Where it appears |
| --- | --- | --- |
| **Activity** | A record of everything that has happened | The Admin Activity page and the IT activity log |
| **Requests** | A person is asking for help or for an approval | The Admin Requests page and the IT Work Center |
| **Alerts** | Something is happening right now that people should know about | The topbar alert icon, a card over the bottom of the Dashboard map and the map pins, for both the Admin and IT |

Something TANAW detects by itself, such as a camera that stopped counting, is
never a request. It shows as an alert while it lasts, and Activity keeps the
history.

## Part 1: Activity

### 1.1 What is recorded

Activity records every action by every user, and every event TANAW itself
causes, so there is a complete record for transparency.

- **One event, one record.** If one action triggers several steps (an account
  is created and an invitation email is sent), they make a single record.
- **The record never changes once written.** Activity has no "unresolved" state
  and nothing is pinned. Open problems belong in Requests or Alerts.
- **Each record holds:** who did it, their role, what they did, what it was done
  to, when, and whether it worked.
- **Records are kept for the retention period IT chooses** (90, 180 or 365
  days), as today.

### 1.2 Who sees it

Admin and IT see every record. LGU Staff and enterprise accounts don't see
Activity.

They see the same records, worded for each audience:

| | Admin | IT |
| --- | --- | --- |
| Wording | Plain language for a non-technical reader | Plain language, plus the technical details that help IT act |
| Extra details | None | For example: the camera name, the error message, the desktop app version, the last successful upload, or a setting's old and new values |

Neither view ever shows passwords, verification codes, security fingerprints,
internal record IDs or raw error dumps.

**Example: a camera stops counting.**

- Admin: "The main gate camera at San Pedro Public Market stopped counting ·
  3:15 PM"
- IT: the same line, plus "Camera: Gate A · Error: the connection was refused
  · Desktop app 1.4.2 · Last upload 2:40 PM".

### 1.3 Groups and events

The **Today** column compares each event with the current code. It uses these
values:

- **Same**: exists today, possibly with a clearer title.
- **Merged**: replaces two or more of today's records.
- **Was an alert**: moves here from today's IT alerts.
- **New**: not recorded today.

#### Login & Security

| Event | Done by | Today |
| --- | --- | --- |
| Signed in | Any account | Same |
| Signed out | Any account | Same |
| Account locked after wrong passwords | TANAW | Was an alert (Failed Login Threshold) |
| Password changed | Any account | Same |
| Password recovery requested | Anyone, from the sign-in page | Same |
| Recovery code or link rejected | TANAW | Merged (code rejected, reset rejected) |
| Password reset through Forgot password | The account holder | Merged (Password Reset, Reset Completed, Code Verified) |

A single wrong password is not recorded. Only the lockout that follows
repeated wrong passwords is.

#### Accounts

| Event | Done by | Today |
| --- | --- | --- |
| Account created, with the invitation sent | IT | Merged (Create Account, Activation Email Queued) |
| Account details updated | IT | Same |
| Account activated or deactivated | IT | Same |
| Invitation resent | IT | Merged (Resend Activation, Activation Email Queued) |
| Invitation accepted | The new account holder | Same |
| Profile updated (name, photo, lead admin, building capacity) | Any account | Merged (four profile records) |
| New email verified | The account holder | Same |
| Account change approved | IT | Merged (email change and profile change approvals) |
| Account change declined | IT | Merged (email change and profile change declines) |

#### Reports

| Event | Done by | Today |
| --- | --- | --- |
| Report submitted | Enterprise, from the desktop app | Same |
| Report set to pending review | Staff or Admin | Same |
| Report review completed | Staff or Admin | Same |
| Report consolidated | Staff or Admin | Same |
| Consolidated report generated | Staff or Admin | Same |
| Consolidated report finalized | Staff or Admin | Same |
| Consolidated report archived | Staff or Admin | Same |
| Consolidated report restored from the archive | Staff or Admin | Same, but today it reads like a normal status change |
| Message sent to an enterprise | Staff or Admin | Same |

#### Requests

| Event | Done by | Today |
| --- | --- | --- |
| Request sent | Enterprise, or anyone from the sign-in page | Merged (support ticket sent, login support alert, account change requested) |
| Reply sent | IT or the sender | Same, and the Admin now sees it |
| Message to IT | Admin | Same |
| Request moved to another group | IT | New |
| Request in progress | IT | Same |
| Request resolved | IT | Same |
| Request reopened | IT or the sender | Same |
| Account change request cancelled | Enterprise | Same |

#### Monitoring

| Event | Done by | Today |
| --- | --- | --- |
| Camera stopped counting | TANAW | Merged (Desktop Application Problem, camera error alert) |
| Camera counting again | TANAW | Same (Technical Issue Resolved) |
| Place busier than usual | TANAW | Same |
| Place back to usual | TANAW | Same |
| Desktop app offline during opening hours, recorded once for the whole period when it reconnects | TANAW | New |
| Place marked temporarily closed, or open again | Enterprise, from the desktop app | New |
| Opening hours changed | Enterprise, from the desktop app | New |

#### Settings & Maintenance

| Event | Done by | Today |
| --- | --- | --- |
| System settings changed | IT | Same, now with which setting changed |
| Old activity deleted | IT | Same |
| Data retention cleanup run | IT | Same |
| Email delivery retried | IT | Same |
| Camera added, removed or changed | Enterprise, from the desktop app | New |
| Counting area changed | Enterprise, from the desktop app | New |
| Desktop data reset | Enterprise, from the desktop app | New |

The desktop app events are new because today these actions are only saved on
the enterprise's computer. The desktop app would need to send them to the
server.

## Part 2: Requests

### 2.1 Name

Everything a person sends for help or approval is called a **request**, in the
portal and in the desktop app. The word "ticket" is no longer used on screen.
The backend can keep its `SupportTicket` name internally.

Every request has a reference number in the same format, for example
`REQ-000142`. This includes account changes, which use a long internal ID
today.

### 2.2 Groups

The sender describes the problem in their own words. The group only sorts the
request, and IT can move a request to another group if it was put in the wrong
one.

| Group | How the request is made | Group set by |
| --- | --- | --- |
| Sign-in help | The "Contact support" form on the sign-in page, by someone who can't sign in | TANAW, automatically |
| Desktop app or camera problem | The desktop app's support form | The sender |
| Report problem | The desktop app's support form, for example a failed upload or a wrong submitted report | The sender |
| Account change | Editing a field that needs approval in the desktop app | TANAW, automatically |
| Other | The desktop app's support form, when nothing else fits | The sender |

### 2.3 What a request holds

- **Title and description**, written by the sender.
- **Photos**, optional.
- **The place**, filled in from the sender's account, plus an optional affected
  area and camera for a desktop app or camera problem.
- **The conversation** between the sender and IT, and any messages from the
  Admin.

Requests have no priority or urgency. They show open first, then newest first.

### 2.4 Account changes

These three fields need IT's approval before they change:

- Business email. The new address must be verified first, as today.
- Contact number.
- Enterprise name. This is new. Reports already sent keep the name they were
  sent with.

Every other profile field changes right away and is only recorded in
Activity.

### 2.5 Status

| Status | Meaning |
| --- | --- |
| In progress | Sent to IT and not finished yet. Every new request starts here |
| Resolved | IT finished it. For an account change, IT closed it without approving |
| Approved | IT approved an account change |

A resolved request can be reopened by IT or by the sender, and it goes back to
In progress. An account change is decided once: IT approves it, or resolves it
without approving, and it can't be reopened.

### 2.6 Who sees and handles requests

- **IT** handles every request in the Work Center: it replies, changes the
  status, moves the group, and approves account changes or resolves them
  without approving.
- **The Admin** sees every request, of every type, on the Requests page. The Admin can add a note for IT on any request, but can't
  change its status or send a request.
- **LGU Staff** don't see Requests.
- **The sender** sees their own requests and the replies in the desktop app.

"New" and "Updated" marks on the Requests page are saved per account, so
they're the same on every device.

## Part 3: Alerts

### 3.1 Kinds of alert

| Alert | Starts when | Ends when |
| --- | --- | --- |
| Busier than usual | A place has more visitors than its usual count for that time | The count is back to usual |
| Camera not counting | A camera has reported an error for 15 minutes in a row | The camera is counting again |

The 15-minute wait stops a camera that drops for a few seconds from raising an
alert. IT can change it in system settings: 5, 15, 30 or 60 minutes.

### 3.2 Desktop app offline: a status, not an alert

A place can be closed for a holiday, a vacation or repairs, so a desktop app
that isn't running isn't always a problem. It is shown as information only:

- **Offline** means the connection between the desktop app and TANAW's server
  is broken for 10 minutes in a row during the place's opening hours. The
  desktop app checks in with the server every 30 seconds while it runs, so 10
  minutes is 20 missed check-ins. Short internet drops don't count.
- The server can't tell why the connection broke. The app may be closed, the
  computer may be off, or the internet may be down. All three show as offline.
- The place's pin on the map turns gray, and its details say "Desktop app
  offline since 10:05 AM".
- While it can't connect, the desktop app keeps counting and saves the visitor
  records on the computer, as it does today. It sends them when the connection
  is back, so no counts are lost.
- When the connection is back, the desktop app reports whether it was running
  the whole time. Activity then records one entry for the whole offline period,
  for example "Desktop app could not connect from 10:05 AM to 11:20 AM (the app
  was running)" or "Desktop app was closed from 10:05 AM to 11:20 AM".
- The desktop app also tells the enterprise on screen that it has no connection
  to TANAW.
- It isn't an alert, so it doesn't appear in the topbar alert icon.
- If a place stays offline for a whole opening day, IT gets one informational
  notice so it can check in with the enterprise. The Admin doesn't.
- Outside opening hours, or on days the place is marked temporarily closed, the
  place is never shown as offline.

This needs two things TANAW doesn't store today:

- **Opening hours for each place.** Today there is only an optional text field.
  The new field covers:
  - Each day of the week on its own, so weekdays and weekends can differ.
  - One or more opening periods per day, so a midday break is possible, for
    example 8:00 AM to 12:00 PM and 1:00 PM to 5:00 PM.
  - Days the place is always closed.
  - Places open 24 hours.
- **Temporary closures**, as a date range with an optional reason, for example
  "Closed for renovation, Dec 1 to Dec 7".

Who sets them:

- **IT enters the opening hours when it creates the enterprise account.** It is
  a new field in the Create Enterprise Account form.
- **The enterprise can change its opening hours and mark temporary closures in
  the desktop app.** IT can also change both from the enterprise account.

Both change right away, without IT's approval, and are recorded in Activity.

### 3.3 How alerts behave

- **Alerts are live.** An alert appears when its problem starts and disappears
  by itself when it ends. Nobody marks an alert as handled.
- **Each start and end is also recorded in Activity**, under Monitoring, so the
  history stays.
- **The topbar alert icon shows a count of live alerts**, so nobody has to keep
  watching the map (see 3.4). Alerts never go into the notification bell.
- **The enterprise sees a clear message in the desktop app** when one of its
  cameras is not counting.
- **If the enterprise wants help**, it sends a request in the "Desktop app or
  camera problem" group. The alert itself never becomes a request.

### 3.4 Where alerts appear

Alerts don't get a page of their own. There are only ever a few at a time, and
they are information only. They appear in three places.

**1. The topbar alert icon.**

- A warning-triangle icon in the topbar shows how many alerts are live right
  now. It has no count when there are none.
- **For the Admin it replaces the notification bell.** The Admin portal has no
  bell and no Notifications page. New and updated requests show on the
  Requests page instead.
- IT keeps its notification bell for messages such as replies, and has the
  alert icon beside it.
- Clicking the icon opens a dialog listing every live alert. Each row has an
  icon for its kind (amber for busier than usual, red for a camera not
  counting), the place, the camera, and when it started.
- Each row has a "Show on map" button that opens the Dashboard at that place.
- IT's dialog adds the technical details from 1.2.

**2. A card over the bottom of the Dashboard map.** It floats over the map,
as the old "More visitors than usual" card did, so it takes no extra space.
One alert shows on one line with "Show". Several alerts show a summary, such
as "2 live alerts" and the places, with "View all" to open the list. Each row
shows that place on the map. Dismissing the card hides it until an alert
starts or ends. The IT Dashboard has no map, so it lists the alerts in a
section instead.

**3. The map pins.** Each place's pin shows its current state by colour:

| Pin | Meaning | Colour (from `DESIGN.md`) |
| --- | --- | --- |
| Normal | Open, counting, usual visitors | The current pin colour |
| Yellow | Busier than usual | Warning amber |
| Red | A camera is not counting | Danger red |
| Gray | Desktop app offline during opening hours | Neutral slate |
| Faded | Outside opening hours, or temporarily closed | The current pin colour at low opacity |

These rules apply to the pins:

- **Only one colour shows at a time.** Gray wins, because TANAW has no fresh
  counts from an offline place. Otherwise red wins over yellow, because a
  camera that isn't counting makes the visitor count incomplete. The pin's
  details list everything that applies.
- **Colour is never the only signal.** Each state also has a small icon inside
  the pin, and a legend sits at the top of the map. This helps people who can't tell
  red from green.
- **The whole pin turns red when any one camera fails.** The details name the
  camera, for example "Gate A is not counting. 3 of 4 cameras are counting."

## Part 4: Removed

| Removed | Reason |
| --- | --- |
| "Records waiting to upload" alert | The desktop app already retries uploads every 20 seconds. It tells the enterprise when it needs to sign in again |
| Account lockout as an alert | A lockout ends by itself after a few minutes. It is recorded in Activity instead |
| Alerts on the Requests page | Requests come only from people |
| Password Reset Request, Submission Delay and Occupancy Spike alert types | Nothing raises them |
| Important Support Request and Request Account Update records | Only sample data writes them |
| Separate records for one event | Merged into one record each (see 1.3) |
| Pinned and unresolved activity | Open problems are in Requests and Alerts |
| Ticket priority chosen by the sender, and IT's urgent flag | Requests are handled newest first; the Sent and Declined statuses went too |
| Admin sees only High and Urgent requests | The Admin sees all requests |
| "Your response" buttons for Admin-owned alerts | Alerts end by themselves, and the Admin doesn't handle requests |

## Part 5: What Changes In Each App

The database changes follow the pre-production policy in `AGENTS.md`: update
the canonical baselines directly, with no incremental migrations.

### Backend

- Write one activity record per event.
- Let both the Admin and IT read every activity record.
- Add a short plain summary and an IT detail field to each activity record.
- Merge support tickets, login support requests and account change requests
  into one request model. It holds a group, a status and a reference number.
- Add enterprise name to the fields that need approval.
- Raise "Camera not counting" only after the wait set in system settings
  (15 minutes by default).
- Stop raising the stuck-upload and lockout alerts, and remove the alert types
  that are never raised.
- Store opening hours as days and times, and temporary closures as date
  ranges.
- Track when each desktop app last checked in, and work out the offline status
  from that and the opening hours.
- Accept the desktop app's report of an offline period when it reconnects, and
  record it in Activity.
- Save Requests read marks per account.

### Admin and IT portals

- Activity: the new groups, the two levels of wording, and no pinning.
- Requests: the new groups and statuses, every request listed for the Admin,
  notes for IT instead of status buttons, and no alerts.
- Dashboard: a live alerts card over the bottom of the Admin map (a section on
  the IT Dashboard), coloured map pins with icons, and a legend.
- Topbar: an alert icon with a count of live alerts, opening a dialog with
  "Show on map". The Admin's notification bell and Notifications page are
  removed.
- IT system settings: the camera wait time.
- IT enterprise accounts: an opening hours field when creating or editing an
  account, and temporary closures.

### Desktop app

- Rename "Support ticket" to "Request" and use the new groups, without a
  priority picker.
- Send an account change request when the enterprise name is edited.
- Show a clear message when a camera is not counting, or when sign-in is needed
  to upload.
- Send camera setup, counting area and data reset events to the server for
  Activity.
- Let the enterprise change its opening hours and mark temporary closures.
- Tell the enterprise on screen when it has no connection to TANAW.
- When the connection comes back, report how long it was offline and whether
  the app was running.

## Part 6: Decisions

| # | Question | Decision |
| --- | --- | --- |
| 1 | Should Requests read marks follow the account? | Yes (2.6) |
| 2 | Should a desktop app that is offline during opening hours be flagged? | Yes, as information only: a gray pin and an Activity record, with no notification (3.2) |
| 3 | Should each wrong password be recorded? | No, only the lockout (1.3) |
| 4 | Can the Admin or Staff send requests? | No. The Admin can add a note for IT on an existing request (2.6) |
| 5 | Should IT be able to change the camera wait time? | Yes, in system settings (3.1) |
| 6 | Where do alerts appear? | The topbar alert icon with a dialog (it replaces the Admin's notification bell), the card over the bottom of the map, and coloured map pins (3.4) |
| 7 | When is a place offline? | When the connection between the desktop app and the server is broken for 10 minutes during opening hours (3.2) |
| 8 | What can opening hours hold? | Different hours per day, breaks, closed days and 24 hours, entered by IT at account creation (3.2) |

There are no open questions left.
