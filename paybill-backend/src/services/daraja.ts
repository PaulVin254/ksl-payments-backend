import axios from "axios";
import { generatePassword, generateTimestamp } from "../utils/mpesa.js";

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

export interface C2bRegisterUrlParams {
  validationUrl?: string;
  confirmationUrl?: string;
  responseType?: "Completed" | "Cancelled";
}

export interface C2bRegisterUrlResponse {
  OriginatorConversationID: string;
  ResponseCode: string;
  ResponseDescription: string;
}

export class DarajaPaybillService {
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  get environment(): string {
    return (process.env.DARAJA_ENVIRONMENT || "sandbox").trim().toLowerCase();
  }

  get consumerKey(): string {
    return (process.env.DARAJA_CONSUMER_KEY || "").trim();
  }

  get consumerSecret(): string {
    return (process.env.DARAJA_CONSUMER_SECRET || "").trim();
  }

  /**
   * For Paybill, your ShortCode is your Paybill Number.
   * In sandbox, defaults to 174379.
   */
  get shortcode(): string {
    return (process.env.DARAJA_PAYBILL_NUMBER || "174379").trim();
  }

  /**
   * For Paybill STK Push, PartyB is ALWAYS the Paybill Number (same as ShortCode).
   */
  get partyB(): string {
    return this.shortcode;
  }

  get passkey(): string {
    return (
      process.env.DARAJA_PASSKEY ||
      "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919"
    ).trim();
  }

  get callbackUrl(): string {
    const raw = (process.env.DARAJA_CALLBACK_URL || "").trim();
    if (!raw) return "";
    const configuredSecret = process.env.DARAJA_WEBHOOK_SECRET?.trim();
    if (configuredSecret && !raw.includes("token=")) {
      const sep = raw.includes("?") ? "&" : "?";
      return `${raw}${sep}token=${encodeURIComponent(configuredSecret)}`;
    }
    return raw;
  }

  get c2bValidationUrl(): string {
    const raw = (process.env.DARAJA_C2B_VALIDATION_URL || "").trim();
    if (!raw) return "";
    const secret = process.env.DARAJA_WEBHOOK_SECRET?.trim();
    if (secret && !raw.includes("token=")) {
      const sep = raw.includes("?") ? "&" : "?";
      return `${raw}${sep}token=${encodeURIComponent(secret)}`;
    }
    return raw;
  }

  get c2bConfirmationUrl(): string {
    const raw = (process.env.DARAJA_C2B_CONFIRMATION_URL || "").trim();
    if (!raw) return "";
    const secret = process.env.DARAJA_WEBHOOK_SECRET?.trim();
    if (secret && !raw.includes("token=")) {
      const sep = raw.includes("?") ? "&" : "?";
      return `${raw}${sep}token=${encodeURIComponent(secret)}`;
    }
    return raw;
  }

  /**
   * Paybill STK Push TransactionType is always CustomerPayBillOnline
   */
  get transactionType(): string {
    return "CustomerPayBillOnline";
  }

  private getBaseUrl(): string {
    return this.environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
  }

  /**
   * Generates or returns a valid cached OAuth bearer token from Safaricom.
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiresAt - 60000) {
      return this.cachedToken;
    }

    if (!this.consumerKey || !this.consumerSecret) {
      throw new Error(
        "DARAJA_CONSUMER_KEY or DARAJA_CONSUMER_SECRET is missing in environment variables!"
      );
    }

    const authHeader = Buffer.from(
      `${this.consumerKey}:${this.consumerSecret}`
    ).toString("base64");
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
      return access_token;
    } catch (error: any) {
      const errData = error.response?.data || error.message;
      console.error("[DARAJA OAUTH ERROR]", errData);
      throw new Error(
        `Daraja OAuth failed: ${
          error.response?.data?.errorMessage || error.message
        }`
      );
    }
  }

  /**
   * Dispatches an STK Push prompt to the customer's phone for Paybill.
   */
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
      PartyB: this.partyB,
      PhoneNumber: params.phoneNumber,
      CallBackURL: this.callbackUrl,
      AccountReference: params.accountReference.substring(0, 12),
      TransactionDesc: (
        params.transactionDesc || `Order ${params.accountReference}`
      ).substring(0, 13),
    };

    try {
      const response = await axios.post<StkPushResponse>(url, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 25000,
      });

      return response.data;
    } catch (error: any) {
      const msg =
        error.response?.data?.errorMessage ||
        error.response?.data?.ResponseDescription ||
        error.message ||
        "Failed to trigger M-Pesa STK Push";
      console.error("[DARAJA STK ERROR]", error.response?.data || error.message);
      throw new Error(msg);
    }
  }

  /**
   * Queries Safaricom Daraja STK Push status directly via the query API.
   */
  async queryStkStatus(
    checkoutRequestId: string
  ): Promise<StkQueryResponse | null> {
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

      const response = await axios.post<StkQueryResponse>(url, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      });

      return response.data;
    } catch (error: any) {
      const errData = error.response?.data;
      if (errData && errData.ResultCode !== undefined) {
        return errData as StkQueryResponse;
      }
      console.warn("[DARAJA QUERY ERROR]", errData || error.message);
      return null;
    }
  }

  /**
   * Registers C2B Validation and Confirmation URLs with Safaricom.
   * Call this once during initial deployment so manual Paybill payments trigger webhooks.
   */
  async registerC2bUrl(
    params?: C2bRegisterUrlParams
  ): Promise<C2bRegisterUrlResponse> {
    const token = await this.getAccessToken();
    const url = `${this.getBaseUrl()}/mpesa/c2b/v1/registerurl`;

    const validationUrl = params?.validationUrl || this.c2bValidationUrl;
    const confirmationUrl = params?.confirmationUrl || this.c2bConfirmationUrl;

    if (!validationUrl || !confirmationUrl) {
      throw new Error(
        "Both validationUrl and confirmationUrl are required to register C2B URLs on Daraja."
      );
    }

    const payload = {
      ShortCode: this.shortcode,
      ResponseType: params?.responseType || "Completed",
      ConfirmationURL: confirmationUrl,
      ValidationURL: validationUrl,
    };

    try {
      const response = await axios.post<C2bRegisterUrlResponse>(url, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      });

      return response.data;
    } catch (error: any) {
      const msg =
        error.response?.data?.errorMessage ||
        error.response?.data?.ResponseDescription ||
        error.message ||
        "Failed to register C2B URLs";
      console.error("[C2B REGISTER ERROR]", error.response?.data || error.message);
      throw new Error(msg);
    }
  }
}

export const darajaPaybillService = new DarajaPaybillService();
