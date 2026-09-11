import axios from "axios";
import { generatePassword, generateTimestamp } from "../utils/mpesa.js";

interface StkPushParams {
  phoneNumber: string;
  amount: number;
  accountReference: string;
  transactionDesc?: string;
}

interface StkPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

interface StkQueryResponse {
  ResponseCode: string;
  ResponseDescription: string;
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: string;
  ResultDesc: string;
}

export class DarajaService {
  private environment: string;
  private consumerKey: string;
  private consumerSecret: string;
  private shortcode: string;
  private passkey: string;
  private callbackUrl: string;
  private transactionType: string;

  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.environment = process.env.DARAJA_ENVIRONMENT || "sandbox";
    this.consumerKey = process.env.DARAJA_CONSUMER_KEY || "";
    this.consumerSecret = process.env.DARAJA_CONSUMER_SECRET || "";
    this.shortcode = process.env.DARAJA_BUSINESS_SHORTCODE || "174379";
    this.passkey = process.env.DARAJA_PASSKEY || "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";
    this.callbackUrl = process.env.DARAJA_CALLBACK_URL || "";
    this.transactionType = process.env.DARAJA_TRANSACTION_TYPE || "CustomerBuyGoodsOnline";
  }

  private getBaseUrl(): string {
    return this.environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
  }

  /**
   * Retrieves or refreshes the Daraja OAuth access token
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiresAt - 60000) {
      return this.cachedToken;
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
      });

      const { access_token, expires_in } = response.data;
      this.cachedToken = access_token;
      this.tokenExpiresAt = now + parseInt(expires_in, 10) * 1000;

      return access_token;
    } catch (error: any) {
      console.error("❌ Failed to fetch Daraja OAuth token:", error.response?.data || error.message);
      throw new Error(
        `Daraja OAuth failed: ${error.response?.data?.errorMessage || error.message}`
      );
    }
  }

  /**
   * Triggers an STK Push (Lipa Na M-Pesa Online) to the student's phone
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
      PartyB: this.shortcode,
      PhoneNumber: params.phoneNumber,
      CallBackURL: this.callbackUrl,
      AccountReference: params.accountReference.substring(0, 12),
      TransactionDesc: (params.transactionDesc || "KSL Class Payment").substring(0, 13),
    };

    try {
      const response = await axios.post<StkPushResponse>(url, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      return response.data;
    } catch (error: any) {
      console.error("❌ Daraja STK Push Error:", error.response?.data || error.message);
      throw new Error(
        error.response?.data?.errorMessage ||
          error.response?.data?.ResponseDescription ||
          "Failed to trigger M-Pesa STK Push"
      );
    }
  }

  /**
   * Queries Safaricom for the status of an STK Push request (fallback check)
   */
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
      console.error("❌ Daraja STK Query Error:", error.response?.data || error.message);
      throw new Error(
        error.response?.data?.errorMessage ||
          error.response?.data?.ResponseDescription ||
          "Failed to query STK push status"
      );
    }
  }
}

export const darajaService = new DarajaService();
