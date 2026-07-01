I reviewed the current config with deployment/production in mind. Biggest theme: **TANAW is currently configured very well for local development, but several settings would be risky or fragile if deployed exactly as-is.**

**Findings**

1. **High Risk: production `.env` is still using development/sample values**

I checked your local `.env` without printing secret values. It still matches the sample defaults for:

- `TANAW_ENV`
- PostgreSQL password
- JWT secret
- default/admin/staff/IT startup passwords
- `VITE_API_BASE_URL`

The sample values are visible in [.env.example](/C:/Users/regine/Desktop/TANAW/.env.example:1). In friendly terms: this is like leaving the building key under the welcome mat. It works locally, but in production anyone who knows the sample credentials could try them.

This is made more serious because the backend automatically re-seeds startup accounts on launch in [seed.py](/C:/Users/regine/Desktop/TANAW/backend-tanaw/app/features/accounts/seed.py:26), and it can reset those accounts back to the configured passwords in [seed.py](/C:/Users/regine/Desktop/TANAW/backend-tanaw/app/features/accounts/seed.py:65). So if production uses sample passwords, restarts can keep bringing those passwords back.

2. **High Risk: frontend production build may point users to `localhost`**

In [docker-compose.prod.yml](/C:/Users/regine/Desktop/TANAW/docker-compose.prod.yml:31), the production frontend defaults to:

`http://localhost:8000`

That is dangerous for real deployment because “localhost” means **the visitor’s own computer**, not your server. So a user opening the web app from another PC may have the frontend trying to call an API on their own machine.

For production, `VITE_API_BASE_URL` should be the real backend URL, like `https://api.your-domain.gov.ph`.

3. **High Risk: desktop installer is not self-contained for the ML service**

The desktop package includes ML service source files and models in [electron-builder.json5](/C:/Users/regine/Desktop/TANAW/desktop-tanaw/electron-builder.json5:12), but it does **not** include the `.venv`, Python runtime, or `uv`.

The launcher checks for a bundled `.venv` in [main.ts](/C:/Users/regine/Desktop/TANAW/desktop-tanaw/electron/main.ts:80). If it does not exist, it falls back to running `uv run python main.py` in [main.ts](/C:/Users/regine/Desktop/TANAW/desktop-tanaw/electron/main.ts:86).

Plain version: on another Windows PC, the installed desktop app may fail unless that PC already has `uv`, Python access, and network access to install packages. With CUDA PyTorch, first setup can also be very large.

4. **High Risk: desktop app currently points to local backend**

Your desktop `.env.local` currently points to `http://localhost:8000` in [.env.local](/C:/Users/regine/Desktop/TANAW/desktop-tanaw/.env.local:1), and the desktop axios fallback also uses localhost in [axios.ts](/C:/Users/regine/Desktop/TANAW/desktop-tanaw/src/lib/axios.ts:5).

That is fine for development. But if you build an installer right now, it may bake in the local backend URL. Installed enterprise desktops would then look for the backend on each enterprise PC instead of your real deployed backend.

5. **Medium Risk: backend schema setup is production-fragile**

The backend has Alembic migrations, but startup currently does `Base.metadata.create_all` and several direct `ALTER TABLE` patches in [main.py](/C:/Users/regine/Desktop/TANAW/backend-tanaw/app/main.py:244).

This can work locally, but production database changes should usually go through migrations. Otherwise it becomes harder to know exactly what schema version the database has, roll back changes, or safely upgrade multiple deployments.

6. **Medium Risk: password reset/notification delivery looks development-style**

Password reset challenges are stored in memory in [password_recovery.py](/C:/Users/regine/Desktop/TANAW/backend-tanaw/app/features/auth/password_recovery.py:44), and reset codes are recorded as `DevDelivery` rows in [password_recovery.py](/C:/Users/regine/Desktop/TANAW/backend-tanaw/app/features/auth/password_recovery.py:72).

Plain version: this is not yet a real email/SMS delivery system. If the backend restarts, pending reset challenges disappear. If you run more than one backend process, one process may not know about reset codes created by another.

7. **Medium Risk: Docker “production” still needs a real edge layer**

The production compose file exposes HTTP services directly in [docker-compose.prod.yml](/C:/Users/regine/Desktop/TANAW/docker-compose.prod.yml:20) and [docker-compose.prod.yml](/C:/Users/regine/Desktop/TANAW/docker-compose.prod.yml:32). That is okay for production-like testing, but real production still needs HTTPS, domain routing, certificate renewal, backups, restart policies, and monitoring.

The frontend nginx config is also minimal in [nginx.conf](/C:/Users/regine/Desktop/TANAW/frontend-tanaw/nginx.conf:1). The Vercel deployment has security headers in [vercel.json](/C:/Users/regine/Desktop/TANAW/frontend-tanaw/vercel.json:7), but the Docker nginx version does not include the same full security header setup.

8. **Medium Risk: Windows installer is unsigned**

Windows signing is disabled in [electron-builder.json5](/C:/Users/regine/Desktop/TANAW/desktop-tanaw/electron-builder.json5:24). For real users, Windows SmartScreen or enterprise security policies may warn about or block the installer/app. We already saw Windows Application Control block one Python tool earlier, so this environment is sensitive to unsigned/untrusted executables.

**Good Things I Saw**

The backend does have a production CORS safety guard in [config.py](/C:/Users/regine/Desktop/TANAW/backend-tanaw/app/core/config.py:63). If `TANAW_ENV=production`, it rejects wildcard, localhost, and private CORS origins. That is a good protection.

The ML service binds to `127.0.0.1` by default in [main.py](/C:/Users/regine/Desktop/TANAW/desktop-tanaw/ml-service/main.py:12), which is good. Keep it local-only unless there is a very deliberate reason to expose it.

**Priority Fix Order**

1. Create a real production `.env`: strong JWT secret, strong DB password, real backend/frontend URLs, `TANAW_ENV=production`, no sample account passwords.
2. Stop auto-resetting startup accounts in production, or require an explicit one-time seed mode.
3. Decide how desktop production will bundle/run the ML service: bundled Python/venv, installer bootstrapper, or documented admin install step.
4. Build frontend and desktop with the real production API URL.
5. Add a real migration step: `alembic upgrade head`.
6. Add HTTPS/reverse proxy/backups/restart policies for production Docker.
7. Sign the Windows installer before distribution.