# SF Deploy Agent — Deployment Guide

This guide covers two topics: choosing a hosting platform for the SF Deploy Agent (Express + React + SQLite), and creating a Salesforce Connected App for OAuth.

---

## Part 1: Hosting Platform Comparison

### App Requirements

| Requirement | Detail |
|---|---|
| Runtime | Node.js 20+ |
| Database | SQLite (`sf_deploy.db`) — requires persistent filesystem |
| Environment | `ANTHROPIC_API_KEY` (and others) via env vars |
| Port | 5000 (or configurable via `PORT`) |
| HTTPS | Required for Salesforce OAuth callback |
| Uptime | Always-on (no sleep on inactivity) |

> **Critical note on SQLite:** SQLite stores data in a local file. Any platform that uses an **ephemeral filesystem** (the default on all three platforms) will lose your database on every redeploy or restart. You **must** attach a persistent disk to keep SQLite working. If a platform doesn't support persistent disks, you must migrate to a hosted Postgres instance instead.

---

### Railway

**Overview:** Usage-based pricing with a flat monthly plan fee. Volumes (persistent disks) are fully supported. Strong developer experience with GitHub auto-deploy.

| Feature | Detail |
|---|---|
| Free tier | 30-day trial with $5 usage credits. **No permanent free tier** (removed August 2023). Requires a credit card even for the trial. |
| Cheapest always-on price | **$5/month** (Hobby plan). Includes $5 of monthly usage credits. For a low-traffic Express app, most workloads stay within the $5 credit — so the effective cost is often flat $5/mo. |
| Persistent disk (SQLite) | ✅ **Fully supported.** Volumes are a first-class feature. Mount a volume at a path like `/data`, point SQLite there (`/data/sf_deploy.db`). Up to 5 GB on Hobby. Billed at ~$0.15/GB/month beyond plan usage credits. |
| Ease of setup | ⭐⭐⭐⭐⭐ Excellent. Connect GitHub repo, Railway auto-detects Node.js, deploys on push. Add a volume from the dashboard in ~2 clicks. Set env vars via the dashboard. |
| Custom domain | ✅ Yes (up to 2 custom domains on Hobby). Free `*.up.railway.app` subdomain included — HTTPS automatic. |
| Always-on | ✅ Yes, on Hobby and above. Services run continuously (no sleep). |
| SQLite verdict | ✅ Works. Attach a volume, set `DATABASE_PATH=/data/sf_deploy.db`. Done. |

**Gotcha:** If you exceed $5 of resource usage in a month, you pay for the overage. For a small app, this is uncommon but monitor the usage dashboard.

**Sources:** [Railway Pricing](https://railway.com/pricing) · [GetDeploying Railway Review](https://getdeploying.com/railway) · [SaaS Price Pulse](https://www.saaspricepulse.com/tools/railway)

---

### Render

**Overview:** Flat-rate tiered pricing per service. Persistent disks supported on paid plans only. Well-documented and beginner-friendly.

| Feature | Detail |
|---|---|
| Free tier | 750 free instance-hours/month (enough for one always-on service), but: **ephemeral filesystem only** — SQLite data is lost on every restart/redeploy. Free Postgres expires after 30 days. Not suitable for production. |
| Cheapest always-on price | **$7/month** (Starter plan, 512 MB RAM, 0.5 vCPU). Always-on — no sleep. |
| Persistent disk (SQLite) | ✅ Supported on **paid plans only**. Attach from the service's "Disks" page. Mount path for Node.js: e.g. `/opt/render/project/src/storage`. Priced at **$0.25/GB/month** provisioned (minimum 1 GB = $0.25/mo extra). Adding a disk **disables zero-downtime deploys** — a brief few-second outage occurs on each redeploy. |
| Ease of setup | ⭐⭐⭐⭐ Very good. GitHub integration, auto-deploy on push, env var UI. Persistent disk setup requires a few extra steps vs. Railway. |
| Custom domain | ✅ Yes, on all paid plans. Free `*.onrender.com` subdomain with automatic HTTPS. |
| Always-on | ✅ Yes, on Starter ($7/mo) and above. Free tier services spin down after 15 minutes of inactivity. |
| SQLite verdict | ✅ Works on paid plans. Mount path: e.g. `/opt/render/project/src/storage/sf_deploy.db`. Effective cost: ~$7.25/month (Starter + 1 GB disk). |

**Gotcha:** The free tier is **not viable** for SQLite — the filesystem is ephemeral and the database is wiped on every restart. You must be on a paid plan with a persistent disk attached.

**Sources:** [Render Pricing](https://render.com/pricing) · [Render Persistent Disks Docs](https://render.com/docs/disks) · [Render Free Tier Docs](https://render.com/docs/free)

---

### Fly.io

**Overview:** Pure usage-based pricing, no monthly subscription. Persistent volumes supported. More DevOps-oriented — requires CLI (`flyctl`) and a `fly.toml` config file.

| Feature | Detail |
|---|---|
| Free tier | **No free tier for new accounts** (removed for new orgs as of late 2024). Bills under $5/month are currently waived informally, but this is not a guaranteed policy. |
| Cheapest always-on price | A `shared-cpu-1x` VM with 512 MB RAM runs ~**$3.32/month** if always-on. Add a 1 GB volume at $0.15/mo = ~**$3.47/month** effective. No subscription fee. |
| Persistent disk (SQLite) | ✅ Fully supported. Fly Volumes are NVMe-backed local storage. Mount a volume at a path (e.g. `/data`), configure SQLite path to `/data/sf_deploy.db`. Daily snapshots included (5-day retention by default). |
| Ease of setup | ⭐⭐⭐ Moderate. Requires installing `flyctl` CLI, writing a `fly.toml`, running `fly launch`. More involved than Railway or Render but well-documented. |
| Custom domain | ✅ Yes, via `fly certs add`. Free `*.fly.dev` subdomain with automatic HTTPS. |
| Always-on | ✅ Yes. Fly Machines stay running by default unless you configure `auto_stop`. |
| SQLite verdict | ✅ Works. Fly is actually popular for SQLite apps (see Litestream backup pattern). The trade-off is a steeper setup curve. |

**Gotcha:** Fly recommends running at least 2 volumes per app for reliability (single volume = hardware failure risk). For a hobby/production solo app, one volume is common practice, but be aware of the risk. The free waiver under $5/month is informal and could change.

**Sources:** [Fly.io Resource Pricing](https://fly.io/docs/about/pricing/) · [Fly Volumes Overview](https://fly.io/docs/volumes/overview/) · [Orb Fly.io Pricing Breakdown](https://www.withorb.com/blog/flyio-pricing)

---

### Comparison Summary

| | Railway Hobby | Render Starter | Fly.io (PAYG) |
|---|---|---|---|
| Monthly base cost | $5/mo | $7/mo | ~$3.47/mo |
| Persistent disk | ✅ Up to 5 GB | ✅ Paid plans only | ✅ Volumes |
| SQLite supported | ✅ Yes | ✅ Yes (paid) | ✅ Yes |
| Free tier | Trial only (30d) | 750h/mo (no disk) | None (informal <$5 waiver) |
| Always-on | ✅ Yes | ✅ Yes (paid) | ✅ Yes |
| Custom domain + HTTPS | ✅ Yes | ✅ Yes | ✅ Yes |
| Ease of setup | Excellent | Very good | Moderate |
| Postgres fallback option | ✅ Railway Postgres | ✅ Render Postgres | ✅ Fly Postgres |

---

### Recommendation

**Use Railway Hobby ($5/month).** Here's why:

1. **Best developer experience** — Git push to deploy, volumes added in 2 clicks from the dashboard, env vars UI is clean. No CLI required.
2. **SQLite just works** — Attach a volume, point `DATABASE_PATH` there. No extra setup.
3. **Lowest friction** — The $5 Hobby plan covers both the subscription and typical compute usage for a low-traffic app. You pay $5 flat in most months.
4. **HTTPS + custom domain included** — Satisfies Salesforce OAuth callback requirements immediately.

**Render Starter ($7/month)** is a solid second choice if you prefer flat-rate pricing predictability and a slightly more polished UI. The $7 base is slightly higher than Railway's effective cost, and the disk setup disables zero-downtime deploys — a minor inconvenience.

**Fly.io** is the cheapest in raw compute costs (~$3.47/mo) and technically excellent, but the CLI-first setup adds friction for a project where speed of deployment matters. Best for teams already familiar with container-based workflows.

**If you ever drop SQLite** (e.g., to support multi-instance scaling), both Railway and Render offer managed Postgres. Railway Postgres starts at ~$5–10/mo for a small instance; Render Postgres Basic starts at $6/month.

---

## Part 2: Salesforce Connected App Setup (OAuth Web Server Flow)

This section walks through creating a Connected App in a Salesforce **sandbox** for the OAuth Web Server Flow used by SF Deploy Agent.

### Prerequisites

- System Administrator profile in the sandbox org
- Your deployed app's HTTPS domain (e.g., `https://your-app.up.railway.app`)

---

### Step 1: Log Into the Sandbox

Navigate to:
```
https://test.salesforce.com
```

Enter your sandbox username (format: `username@domain.com.sandboxname`) and password.

> **Note:** Sandbox orgs always use `test.salesforce.com` for login. Production orgs use `login.salesforce.com`. This distinction matters when configuring the OAuth authorization URL in your app.

---

### Step 2: Open Setup

Once logged in, click the **gear icon** (⚙️) in the top-right corner and select **Setup**.

If you see an **"Open Advanced Setup"** option, click that — it takes you to the full Setup home.

---

### Step 3: Navigate to App Manager

In the **Quick Find** box on the left sidebar, type:
```
App Manager
```

Select **App Manager** from the results. This opens the Lightning Experience App Manager, which lists all apps and connected apps in the org.

> **Summer '25+ note:** In newer Salesforce releases, you may first need to go to **Setup > External Client Apps > Settings** and ensure **"Allow creation of connected apps"** is turned on before the New Connected App button is available.

---

### Step 4: Create a New Connected App

Click **New Connected App** in the top-right corner of the App Manager page.

Fill in the **Basic Information** section:

| Field | Value |
|---|---|
| Connected App Name | `SF Deploy Agent` (or your preferred name) |
| API Name | Auto-fills (e.g., `SF_Deploy_Agent`) — leave as-is |
| Contact Email | Your email address |
| Description | (Optional) `OAuth integration for SF Deploy Agent` |

---

### Step 5: Enable OAuth Settings

Scroll down to the **API (Enable OAuth Settings)** section and check the box:
- ☑ **Enable OAuth Settings**

The OAuth fields will expand.

**Callback URL:**

Enter your app's callback URL. This must be HTTPS:
```
https://YOUR-APP-DOMAIN.com/api/oauth/callback
```

For example, if deployed on Railway:
```
https://your-app.up.railway.app/api/oauth/callback
```

> You can enter multiple callback URLs (one per line) if you need both a staging and production URL. The field supports up to 2,000 characters total.

---

### Step 6: Select OAuth Scopes

In the **Available OAuth Scopes** list, add the following scopes (double-click each or use the **Add** arrow):

| Scope Label | Token Value |
|---|---|
| Full access | `full` |
| Perform requests at any time | `refresh_token, offline_access` |
| Access content resources | `content` |
| Manage user data via APIs | `api` |

After adding, the **Selected OAuth Scopes** box should show all four.

> **Scope notes:**
> - `full` grants access to everything the logged-in user can access. If you want tighter permissions later, you can replace it with specific scopes.
> - `refresh_token, offline_access` is essential — without it, the app can't refresh expired tokens and users will need to re-authenticate constantly.
> - `api` covers REST API and Bulk API access. `content` is needed for file/content resources.

**Other settings to check:**

- ☑ **Require Secret for Web Server Flow** — Keep this checked. It requires your app to send the `client_secret` when exchanging the authorization code for an access token.
- ☐ **Require Proof Key for Code Exchange (PKCE)** — Leave this **unchecked** unless your app explicitly implements PKCE.

---

### Step 7: Save the Connected App

Scroll to the bottom and click **Save**.

Salesforce will display a confirmation screen. Click **Continue**.

> ⏱ **Wait 2–10 minutes** after saving before testing the OAuth flow. Salesforce needs time to propagate the new connected app settings across its infrastructure. Attempting to authorize before propagation completes will result in errors.

---

### Step 8: Retrieve Consumer Key and Consumer Secret

After saving, you'll land on the Connected App detail page.

1. Click **Manage Consumer Details** (you may be prompted to verify your identity via email code).
2. A new window opens showing:
   - **Consumer Key** (also called `client_id`)
   - **Consumer Secret** (also called `client_secret`)

Copy both values immediately and store them securely.

Add them to your app's environment variables:
```
SF_CLIENT_ID=<Consumer Key>
SF_CLIENT_SECRET=<Consumer Secret>
```

> **Security:** Treat the Consumer Secret like a password. Never commit it to source control. Use your platform's environment variable management (Railway dashboard, Render dashboard, Fly secrets) to store it.

---

### Step 9: Configure OAuth Endpoints in Your App

Set the following in your app's environment or config, depending on whether you're targeting sandbox or production:

| Environment | Authorization URL | Token URL |
|---|---|---|
| **Sandbox** | `https://test.salesforce.com/services/oauth2/authorize` | `https://test.salesforce.com/services/oauth2/token` |
| **Production** | `https://login.salesforce.com/services/oauth2/authorize` | `https://login.salesforce.com/services/oauth2/token` |

Your app likely sets this via an env var such as:
```
SF_LOGIN_URL=https://test.salesforce.com   # for sandbox
SF_LOGIN_URL=https://login.salesforce.com  # for production
```

---

### Step 10: Verify the Setup

To confirm the Connected App is working:

1. Trigger the OAuth flow in your app (e.g., navigate to the login/connect endpoint).
2. You should be redirected to `test.salesforce.com` (sandbox) or `login.salesforce.com` (production).
3. After logging in and clicking **Allow**, Salesforce redirects back to your callback URL with an authorization code.
4. Your app exchanges the code for an access token and refresh token.

If you see an error like `invalid_client_id` or `redirect_uri_mismatch`, double-check:
- The Consumer Key is correct in your env vars.
- The callback URL in the Connected App **exactly** matches the URL your app is using (including trailing slash or lack thereof).
- It has been at least 2–10 minutes since saving the Connected App.

---

### Important Notes

- **Sandbox vs. Production auth URLs:** This is the most common mistake. Sandbox always uses `test.salesforce.com`. If you use `login.salesforce.com` against a sandbox org, authentication will fail.
- **Connected App propagation:** Changes to the Connected App (adding scopes, changing callback URLs) also take 2–10 minutes to take effect.
- **Rotating credentials:** If you ever expose the Consumer Secret, go to **Manage Consumer Details** and click **Reset Consumer Secret**. Update your environment variables immediately.
- **Profiles/Permission Sets:** By default, the Connected App allows all users to self-authorize. If your org has restricted OAuth policies, you may need to explicitly assign the Connected App to user profiles via **Manage Connected Apps > Manage Profiles**.

---

*Sources: [Salesforce OAuth Web Server Flow Docs](https://help.salesforce.com/s/articleView?id=xcloud.remoteaccess_oauth_web_server_flow.htm&language=en_US&type=5) · [Salesforce OAuth Tokens and Scopes](https://help.salesforce.com/s/articleView?id=xcloud.remoteaccess_oauth_tokens_scopes.htm&language=en_US&type=5) · [Salesforce OAuth Endpoints](https://help.salesforce.com/s/articleView?id=xcloud.remoteaccess_oauth_endpoints.htm&language=en_US&type=5) · [Create a Connected App](https://help.salesforce.com/s/articleView?id=xcloud.connected_app_create.htm&language=en_US&type=5)*
