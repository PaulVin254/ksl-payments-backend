import axios from "axios";
import { generatePassword, generateTimestamp } from "../utils/mpesa.js";
import { logEvent } from "../index.js";
export class DarajaService {
    cachedToken = null;
    tokenExpiresAt = 0;
    get environment() {
        return (process.env.DARAJA_ENVIRONMENT || "sandbox").trim().toLowerCase();
    }
    get consumerKey() {
        return (process.env.DARAJA_CONSUMER_KEY || "").trim();
    }
    get consumerSecret() {
        return (process.env.DARAJA_CONSUMER_SECRET || "").trim();
    }
    /**
     * The Daraja Organization / Store / Head Office Number.
     * In sandbox, this is 174379. In production, this is your 6-7 digit Store Number.
     */
    get shortcode() {
        return (process.env.DARAJA_BUSINESS_SHORTCODE || "174379").trim();
    }
    /**
     * The customer-facing Buy Goods Till Number (5-6 digits).
     * In sandbox, defaults to the shortcode. In production, set via DARAJA_TILL_NUMBER.
     */
    get tillNumber() {
        return (process.env.DARAJA_TILL_NUMBER || this.shortcode).trim();
    }
    /**
     * PartyB determines where funds are credited in STK Push:
     * - Sandbox or Paybill: PartyB = BusinessShortCode
     * - Production Buy Goods: PartyB = Till Number
     */
    get partyB() {
        if (this.environment === "sandbox" || this.shortcode === "174379") {
            return this.shortcode;
        }
        return this.tillNumber;
    }
    get passkey() {
        return (process.env.DARAJA_PASSKEY ||
            "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919").trim();
    }
    get callbackUrl() {
        const raw = (process.env.DARAJA_CALLBACK_URL || "").trim();
        if (!raw)
            return "";
        const configuredSecret = process.env.DARAJA_WEBHOOK_SECRET?.trim();
        if (!configuredSecret && this.environment === "production") {
            logEvent("ERROR", "DARAJA_WEBHOOK_SECRET is missing in production environment!", undefined, "SECURITY");
            throw new Error("DARAJA_WEBHOOK_SECRET is required in production mode");
        }
        const secret = configuredSecret || "ksl_dev_secret_2026";
        if (secret && !raw.includes("token=")) {
            const sep = raw.includes("?") ? "&" : "?";
            return `${raw}${sep}token=${encodeURIComponent(secret)}`;
        }
        return raw;
    }
    /**
     * TransactionType:
     * - Sandbox: strictly CustomerPayBillOnline (Safaricom sandbox requirement)
     * - Production Buy Goods: CustomerBuyGoodsOnline (or overridden by DARAJA_TRANSACTION_TYPE)
     */
    get transactionType() {
        if (this.environment === "sandbox" || this.shortcode === "174379") {
            return "CustomerPayBillOnline";
        }
        return process.env.DARAJA_TRANSACTION_TYPE || "CustomerBuyGoodsOnline";
    }
    getBaseUrl() {
        return this.environment === "production"
            ? "https://api.safaricom.co.ke"
            : "https://sandbox.safaricom.co.ke";
    }
    async getAccessToken() {
        const now = Date.now();
        if (this.cachedToken && now < this.tokenExpiresAt - 60000) {
            logEvent("INFO", "Using cached Daraja OAuth token", undefined, "DARAJA");
            return this.cachedToken;
        }
        if (!this.consumerKey || !this.consumerSecret) {
            const err = "DARAJA_CONSUMER_KEY or DARAJA_CONSUMER_SECRET is missing in environment variables!";
            logEvent("ERROR", err, undefined, "DARAJA");
            throw new Error(err);
        }
        logEvent("INFO", `Requesting OAuth token from Safaricom (${this.environment})`, undefined, "DARAJA");
        const authHeader = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString("base64");
        const url = `${this.getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`;
        try {
            const response = await axios.get(url, {
                headers: {
                    Authorization: `Basic ${authHeader}`,
                },
                timeout: 15000,
            });
            const { access_token, expires_in } = response.data;
            this.cachedToken = access_token;
            this.tokenExpiresAt = now + parseInt(expires_in, 10) * 1000;
            logEvent("SUCCESS", "Daraja OAuth token obtained successfully", {
                expiresIn: `${expires_in}s`,
                tokenPreview: `${access_token.slice(0, 8)}...`,
            }, "DARAJA");
            return access_token;
        }
        catch (error) {
            const errData = error.response?.data || error.message;
            logEvent("ERROR", "Failed to fetch Daraja OAuth token", errData, "DARAJA");
            throw new Error(`Daraja OAuth failed: ${error.response?.data?.errorMessage || error.message}`);
        }
    }
    async initiateStkPush(params) {
        const token = await this.getAccessToken();
        const timestamp = generateTimestamp();
        const password = generatePassword(this.shortcode, this.passkey, timestamp);
        const url = `${this.getBaseUrl()}/mpesa/stkpush/v1/processrequest`;
        const payload = {
            BusinessShortCode: this.shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: this.transactionType,
            Amount: Math.round(params.amount),
            PartyA: params.phoneNumber,
            PartyB: this.partyB,
            PhoneNumber: params.phoneNumber,
            CallBackURL: this.callbackUrl,
            AccountReference: params.accountReference.substring(0, 12),
            TransactionDesc: (params.transactionDesc || "KSL Class Payment").substring(0, 13),
        };
        logEvent("INFO", `Dispatching STK Push to Safaricom (${url})`, {
            phoneNumber: params.phoneNumber,
            amount: params.amount,
            shortcode: this.shortcode,
            partyB: this.partyB,
            transactionType: this.transactionType,
            callbackUrl: this.callbackUrl,
        }, "DARAJA");
        try {
            const response = await axios.post(url, payload, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                timeout: 25000,
            });
            logEvent("SUCCESS", "Safaricom accepted STK Push prompt!", {
                MerchantRequestID: response.data.MerchantRequestID,
                CheckoutRequestID: response.data.CheckoutRequestID,
                CustomerMessage: response.data.CustomerMessage,
                ResponseCode: response.data.ResponseCode,
            }, "DARAJA");
            return response.data;
        }
        catch (error) {
            const errData = error.response?.data || error.message;
            logEvent("ERROR", "Safaricom rejected STK Push request", errData, "DARAJA");
            const msg = error.response?.data?.errorMessage ||
                error.response?.data?.ResponseDescription ||
                error.message ||
                "Failed to trigger M-Pesa STK Push";
            throw new Error(msg);
        }
    }
    /**
     * Queries Safaricom Daraja STK Push status directly via the query API.
     * Useful for active reconciliation if a webhook callback was dropped by the gateway.
     */
    async queryStkStatus(checkoutRequestId) {
        try {
            const token = await this.getAccessToken();
            const timestamp = generateTimestamp();
            const password = generatePassword(this.shortcode, this.passkey, timestamp);
            const url = `${this.getBaseUrl()}/mpesa/stkpushquery/v1/query`;
            const payload = {
                BusinessShortCode: this.shortcode,
                Password: password,
                Timestamp: timestamp,
                CheckoutRequestID: checkoutRequestId,
            };
            const response = await axios.post(url, payload, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                timeout: 15000,
            });
            logEvent("INFO", `Daraja query returned response for ${checkoutRequestId}`, response.data, "RECONCILIATION");
            return response.data;
        }
        catch (error) {
            const errData = error.response?.data;
            // Safaricom returns specific payload even on HTTP 400/500 when transaction failed/expired
            if (errData && errData.ResultCode !== undefined) {
                logEvent("INFO", `Daraja query returned definitive status in error payload`, errData, "RECONCILIATION");
                return errData;
            }
            logEvent("WARN", "Daraja STK status query transient error", errData || error.message, "RECONCILIATION");
            return null;
        }
    }
}
export const darajaService = new DarajaService();
