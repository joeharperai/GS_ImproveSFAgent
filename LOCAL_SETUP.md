# Local Setup Guide — SF Deploy Agent + ngrok

Run the SF Deploy Agent on your machine and connect to a real Salesforce sandbox using ngrok for HTTPS tunneling.

## Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **ngrok** — [Download](https://ngrok.com/download) (free tier works)
- **Anthropic API Key** — [Get one](https://console.anthropic.com/)
- **Salesforce Sandbox or Developer Edition** org

---

## Step 1: Clone and Install

```bash
# Navigate to the project
cd sf-deploy-agent

# Install dependencies
npm install
```

## Step 2: Set Environment Variables

Create a `.env` file in the project root:

```bash
# Required: Anthropic API key for the AI agent
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
```

Or export it directly:

```bash
export ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
```

## Step 3: Start the App

```bash
npm run dev
```

The app will start on **http://localhost:5000**.

## Step 4: Start ngrok

In a separate terminal:

```bash
ngrok http 5000
```

ngrok will display a forwarding URL like:

```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:5000
```

Copy the **https://...ngrok-free.app** URL — this is your public URL.

## Step 5: Create a Salesforce Connected App

1. Log into your Salesforce sandbox
2. Go to **Setup → App Manager → New Connected App**
3. Fill in:
   - **Connected App Name**: SF Deploy Agent
   - **API Name**: SF_Deploy_Agent
   - **Contact Email**: your email
4. Check **Enable OAuth Settings**
5. Set **Callback URL** to:
   ```
   https://abc123.ngrok-free.app/api/oauth/callback
   ```
   (Use YOUR ngrok URL)
6. Add **Selected OAuth Scopes**:
   - `Full access (full)`
   - `Perform requests at any time (refresh_token, offline_access)`
7. Uncheck "Require Proof Key for Code Exchange (PKCE)"
8. Save
9. **Wait 2-10 minutes** for the Connected App to propagate
10. Click **Manage Consumer Details** to get your **Consumer Key** and **Consumer Secret**

## Step 6: Connect in the App

1. Open your ngrok URL in a browser: `https://abc123.ngrok-free.app`
2. Go to **Org Connections** in the sidebar
3. Click **Add Org** — enter your sandbox name, instance URL, and type
4. Click **Connect** on the org card
5. Enter your **Consumer Key** and **Consumer Secret**
6. Click **Authenticate with Salesforce**
7. A new window opens — log into Salesforce and authorize the app
8. The window closes automatically — your org is now connected

## Step 7: Test the Connection

Click the **Test** button on the connected org card. If it shows "Connection verified", you're ready to deploy.

---

## Troubleshooting

### "invalid_grant" error during OAuth
- The Connected App may not have propagated yet. Wait 2-10 minutes and try again.
- Make sure the Callback URL in the Connected App matches exactly: `https://YOUR-NGROK-URL/api/oauth/callback`

### "redirect_uri_mismatch" error
- The callback URL you entered in Salesforce doesn't match the URL the app is using.
- The app auto-detects the ngrok URL from request headers. Make sure you're accessing the app via the ngrok URL (not localhost).

### Token expired
- Click the **Refresh** button on the org card to renew the access token.
- If refresh fails, click **Connect** again to re-authenticate.

### ngrok URL changed
- Every time you restart ngrok (free tier), you get a new URL.
- Update the Callback URL in your Salesforce Connected App.
- Or sign up for a [free ngrok static domain](https://ngrok.com/blog-post/free-static-domains-ngrok-users) to keep the same URL.

### CORS issues
- Make sure you're accessing the app through the ngrok URL, not localhost.

---

## Architecture Notes

- **OAuth Web Server Flow**: The app uses Salesforce's standard OAuth 2.0 Web Server flow. Client credentials are stored in the local SQLite database.
- **Token Storage**: Access tokens and refresh tokens are persisted in `sf_deploy.db`. The database file is gitignored.
- **Token Refresh**: The app can refresh expired access tokens using the stored refresh token — no need to re-authenticate.
- **Metadata API**: Once connected, the agent uses Salesforce's Metadata API v60.0 and Tooling API to deploy components.
