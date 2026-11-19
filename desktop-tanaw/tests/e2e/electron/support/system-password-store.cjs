// Playwright's Electron loader appends --password-store=basic, which makes Chromium keep
// secrets as plain text. TANAW rightly refuses that, so specs that save credentials load this
// after Playwright's loader to restore Chromium's normal choice of the operating-system keyring.
const { app } = require("electron");

app.commandLine.removeSwitch("password-store");
