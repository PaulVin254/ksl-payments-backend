# Registered Business Paybill Backend (STK Push + C2B)

A dedicated, production-ready Node.js & TypeScript microservice for handling **Lipa Na M-Pesa Paybill** payments. 

Designed specifically for registered businesses with Daraja API credentials, this service supports both:
1. **Lipa Na M-Pesa Online (STK Push / Express):** Prompts the customer for their M-Pesa PIN directly on their phone with a custom Account/Invoice Reference.
2. **C2B (Customer To Business Manual Payments):** Automatically catches, validates, and reconciles payments made by customers directly through their M-Pesa SIM menu (`Lipa Na M-Pesa > Paybill`).

---

## 1. Quick Start

### 1.1 Install Dependencies
```bash
npm install
```

### 1.2 Database Setup (Supabase)
Run the [`schema.sql`](./schema.sql) file in your [Supabase SQL Editor](https://supabase.com/dashboard/project/aojlbhvjvoxofdzzjrud/sql).

This creates:
- `business_invoices`: Tracks customer invoices, bill references, expected amounts, and payment statuses (`unpaid`, `partially_paid`, `paid`).
- `business_payments`: Logs all incoming STK push and C2B payments, M-Pesa receipt numbers, transaction dates, and raw Safaricom payloads.

### 1.3 Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your credentials:
```env
PORT=3001
NODE_ENV=development
ADMIN_SECRET_KEY=your_secure_admin_token

# Safaricom Daraja Settings
DARAJA_ENVIRONMENT=production # or 'sandbox' for testing
DARAJA_CONSUMER_KEY=your_daraja_consumer_key
DARAJA_CONSUMER_SECRET=your_daraja_consumer_secret
DARAJA_PAYBILL_NUMBER=your_paybill_number # e.g. 174379 in sandbox
DARAJA_PASSKEY=your_daraja_portal_passkey

# Public Webhook Callback (Public HTTPS endpoint or Ngrok)
DARAJA_CALLBACK_URL=https://ca-biz-payments.francecentral.azurecontainer.io/api/mpesa/callback
DARAJA_C2B_VALIDATION_URL=https://ca-biz-payments.francecentral.azurecontainer.io/api/mpesa/c2b/validation
DARAJA_C2B_CONFIRMATION_URL=https://ca-biz-payments.francecentral.azurecontainer.io/api/mpesa/c2b/confirmation
DARAJA_WEBHOOK_SECRET=your_webhook_secret_token

# Supabase
SUPABASE_URL=https://aojlbhvjvoxofdzzjrud.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 1.4 Start Local Server
```bash
npm run dev
```
Healthcheck: `http://localhost:3001/health`

---

## 2. API Endpoints

### A. Initiate STK Push
**Endpoint:** `POST /api/mpesa/stkpush`

**Request Body:**
```json
{
  "phoneNumber": "0712345678",
  "amount": 1500,
  "accountReference": "INV-1024",
  "transactionDesc": "Invoice Payment"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Success. Request accepted for processing",
  "checkoutRequestId": "ws_CO_21102026214500123456",
  "merchantRequestId": "29115-34620561-1",
  "accountReference": "INV-1024"
}
```

### B. STK Push Webhook Callback
**Endpoint:** `POST /api/mpesa/callback`
- Called automatically by Safaricom when the user enters their PIN or cancels.
- Verifies the webhook token secret.
- Automatically marks payment as `completed`, saves the `MpesaReceiptNumber`, and updates `business_invoices` to `paid`.

### C. Manual C2B Validation
**Endpoint:** `POST /api/mpesa/c2b/validation`
- Called automatically by Safaricom before accepting manual Paybill payments.
- Auto-accepts all payments (`ResultCode: 0`) so customer funds are never rejected.

### D. Manual C2B Confirmation
**Endpoint:** `POST /api/mpesa/c2b/confirmation`
- Called by Safaricom upon successful completion of a manual Paybill transaction.
- Stores the transaction under `business_payments` with `payment_method: c2b_manual`.
- Matches `BillRefNumber` against `business_invoices.invoice_number` and marks the invoice as `paid`.

### E. Check Payment Status
**Endpoint:** `GET /api/mpesa/status/:checkoutRequestId`
- Returns payment details from Supabase.
- If pending after 15+ seconds, initiates active reconciliation with Safaricom Daraja Query API.

### F. Register C2B URLs with Safaricom (Admin 1-Click)
**Endpoint:** `POST /api/mpesa/c2b/register`
**Header:** `x-admin-key: <ADMIN_SECRET_KEY>`
**Request Body:**
```json
{
  "responseType": "Completed"
}
```
This registers your `ValidationURL` and `ConfirmationURL` directly with Safaricom Daraja.

---

## 3. Deploying to Azure Container Apps

Since your Azure subscription already hosts `cae-fundi-estimator` (Container Apps Managed Environment in France Central), you can deploy this microservice as `ca-biz-payments` with zero VM management:

```bash
# 1. Create the container app in your existing environment
az containerapp create \
  --name ca-biz-payments \
  --resource-group rg-fundi-estimator \
  --environment cae-fundi-estimator \
  --image ghcr.io/paulvin254/business-paybill-backend:latest \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 2 \
  --cpu 0.25 \
  --memory 0.5Gi

# 2. Set the environment secrets
az containerapp secret set \
  --name ca-biz-payments \
  --resource-group rg-fundi-estimator \
  --secrets \
    daraja-key="YOUR_KEY" \
    daraja-secret="YOUR_SECRET" \
    daraja-passkey="YOUR_PASSKEY" \
    supabase-key="YOUR_SUPABASE_KEY"
```
Once deployed, Azure automatically assigns a permanent HTTPS endpoint (e.g. `https://ca-biz-payments.politefield-xxxx.francecentral.azurecontainerapps.io`), which you use for your `DARAJA_CALLBACK_URL` and C2B URLs.
