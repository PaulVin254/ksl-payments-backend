import axios from "axios";
import { generatePassword, generateTimestamp } from "../utils/mpesa.js";
import { logEvent } from "../index.js";

export interface StkPushParams {
  phoneNumber: string;
  amount: number;
  accountReference: string;
  transactionDesc?: string;
}

export interface StkPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

export interface StkQueryResponse {
  ResponseCode: string;
  ResponseDescription: string;
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: string;
  ResultDesc: string;
}

export class DarajaService {
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  get environment(): string {
    return process.env.DARAJA_ENVIRONMENT || "sandbox";
  }

  get consumerKey(): string {
    return (process.env.DARAJA_CONSUMER_KEY || "").trim();
  }

  get consumerSecret(): string {
    return (process.env.DARAJA_CONSUMER_SECRET || "").trim();
  }

  get shortcode(): string {
    return (process.env.DARAJA_BUSINESS_SHORTCODE || "174379").trim();
  }

  get passkey(): string {
    return (process.env.DARAJA_PASSKEY || "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919").trim();
  }

  get callbackUrl(): string {
    return (process.env.DARAJA_CALLBACK_URL || "").trim();
  }

  get transactionType(): string {
    if (this.shortcode === "174379") {
      return "CustomerPayBillOnline";
    }
    return process.env.DARAJA_TRANSACTION_TYPE || "CustomerPayBillOnline";
  }

  private getBaseUrl(): string {
    return this.environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
  }

  async getAccessToken(): Promise<string> {
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
    } catch (error: any) {
      const errData = error.response?.data || error.message;
      logEvent("ERROR", "Failed to fetch Daraja OAuth token", errData, "DARAJA");
      throw new Error(
        `Daraja OAuth failed: ${error.response?.data?.errorMessage || error.message}`
      );
    }
  }

  async initiateStkPush(params: StkPushParams): Promise<StkPushResponse> {
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
      PartyB: this.shortcode,
      PhoneNumber: params.phoneNumber,
      CallBackURL: this.callbackUrl,
      AccountReference: params.accountReference.substring(0, 12),
      TransactionDesc: (params.transactionDesc || "KSL Class Payment").substring(0, 13),
    };

    logEvent("INFO", `Dispatching STK Push to Safaricom (${url})`, {
      phoneNumber: params.phoneNumber,
      amount: params.amount,
      shortcode: this.shortcode,
      transactionType: this.transactionType,
      callbackUrl: this.callbackUrl,
    }, "DARAJA");

    try {
      const response = await axios.post<StkPushResponse>(url, payload, {
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
    } catch (error: any) {
      const errData = error.response?.data || error.message;
      logEvent("ERROR", "Safaricom rejected STK Push request", errData, "DARAJA");
      const msg =
        error.response?.data?.errorMessage ||
        error.response?.data?.ResponseDescription ||
        error.message ||
        "Failed to trigger M-Pesa STK Push";
      throw new Error(msg);
    }
  }

  async queryStkStatus(checkoutRequestId: string): Promise<StkQueryResponse> {
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

    try {
      const response = await axios.post<StkQueryResponse>(url, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      return response.data;
    } catch (error: any) {
      logEvent("WARN", "Daraja STK status query error", error.response?.data || error.message, "DARAJA");
      throw new Error(
        error.response?.data?.errorMessage ||
          error.response?.data?.ResponseDescription ||
          "Failed to query STK push status"
      );
    }
  }
}

export const darajaService = new DarajaService();
