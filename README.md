# KSL Payments Backend (M-Pesa STK Push)

A production-ready Node.js + Express microservice that bridges **Safaricom Daraja (Lipa Na M-Pesa Online / STK Push)**, **Supabase**, **Brevo Transactional Email**, and the **Meta Cloud WhatsApp API**.

---

## 1. Quick Start (Local Development)

### Install Dependencies
```bash
cd backend
npm install
```

### Environment Variables
Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

Key variables:
- `DARAJA_ENVIRONMENT`: `sandbox` (for testing) or `production`
- `DARAJA_CONSUMER_KEY`: from your Safaricom developer portal app
- `DARAJA_CONSUMER_SECRET`: from your Safaricom developer portal app
- `DARAJA_BUSINESS_SHORTCODE`: `174379` (Sandbox test paybill) or your real Till/Store number
- `DARAJA_PASSKEY`: Sandbox test passkey or production passkey
- `SUPABASE_URL`: `https://aojlbhvjvoxofdzzjrud.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: Service role secret from Supabase Dashboard > Project Settings > API
- `BREVO_API_KEY`: from Brevo > SMTP & API Keys
- `WHATSAPP_API_TOKEN`: from Meta Developer Portal > WhatsApp > API Setup

### Start Development Server
```bash
npm run dev
```
The server will start on `http://localhost:3000`. Test the health check:
```bash
curl http://localhost:3000/health
```

---

## 2. Local Testing with Ngrok (Testing Webhook Callbacks)

Safaricom requires a public HTTPS URL to deliver callbacks when you enter your PIN on your phone.
For local testing:

1. Install Ngrok or run:
   ```bash
   npx ngrok http 3000
   ```
2. Copy the forwarding URL (e.g. `https://a1b2-105-163-1-2.ngrok-free.app`).
3. Update `.env`:
   ```env
   DARAJA_CALLBACK_URL=https://a1b2-105-163-1-2.ngrok-free.app/api/mpesa/callback
   ```
4. Restart your backend (`npm run dev`). Any STK Push will now receive the Safaricom callback locally on your machine!

---

## 3. Deploying to Azure App Service (GitHub Student Pack)

Using your **Azure for Students ($100 credit)**:

### Option A: Azure Portal (GUI - 5 Minutes)
1. Log in to [portal.azure.com](https://portal.azure.com/).
2. Click **Create a Resource** > **Web App** (App Service).
3. Fill in:
   - **Subscription**: Azure for Students
   - **Resource Group**: Create new (e.g. `ksl-payments-rg`)
   - **Name**: `ksl-payments` (will create `https://ksl-payments.azurewebsites.net`)
   - **Publish**: Code
   - **Runtime stack**: Node 20 LTS
   - **Operating System**: Linux
   - **Pricing Plan**: Basic B1 or Free F1
4. Click **Review + Create**.
5. Once created, go to **Deployment Center**:
   - Source: **GitHub**
   - Authorize and select your `ksl-payments-backend` repository.
   - Branch: `main`. Azure will automatically add a GitHub Actions deployment workflow!
6. Go to **Settings > Environment variables** in Azure:
   - Add all the variables from your `.env` file (`DARAJA_CONSUMER_KEY`, `DARAJA_CALLBACK_URL`, etc.).
   - Make sure `DARAJA_CALLBACK_URL` is set to: `https://ksl-payments.azurewebsites.net/api/mpesa/callback`.
7. Your backend is now live 24/7 with a free SSL certificate!

---

## 4. API Endpoints

### 1. `POST /api/mpesa/stkpush`
Triggers an STK push prompt on the student's phone.
```json
{
  "fullName": "Jane Wanjiku",
  "phoneNumber": "0712345678",
  "email": "jane@example.com",
  "amount": 500,
  "paymentTier": "micro"
}
```

### 2. `POST /api/mpesa/callback`
Webhook called automatically by Safaricom Daraja when the user enters their PIN or cancels.
- On success: updates Supabase record to `verified`, sends Brevo email, sends Meta WhatsApp API message with the class invite link.
- On failure: updates Supabase record to `failed`.

### 3. `GET /api/mpesa/status/:checkoutRequestId`
Returns the status of a transaction from Supabase.
