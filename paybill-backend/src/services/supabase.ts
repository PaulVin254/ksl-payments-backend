import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from environment variables."
    );
  }

  supabaseClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseClient;
}

export interface StkInitiationData {
  checkoutRequestId: string;
  merchantRequestId: string;
  accountReference: string;
  amount: number;
  phoneNumber: string;
  invoiceNumber?: string;
}

export interface StkSuccessData {
  checkoutRequestId: string;
  mpesaReceiptNumber: string;
  transactionDate: Date;
  rawCallback: any;
}

export interface StkFailureData {
  checkoutRequestId: string;
  resultCode: string;
  resultDesc: string;
  rawCallback: any;
}

export interface C2bConfirmationData {
  mpesaReceiptNumber: string;
  accountReference: string; // BillRefNumber
  amount: number;
  phoneNumber: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  transactionDate?: Date;
  rawPayload: any;
}

export class BusinessPaymentService {
  /**
   * Records a newly initiated STK Push as 'pending'
   */
  async recordStkInitiation(data: StkInitiationData) {
    const supabase = getSupabase();

    // Check if matching invoice exists
    let invoiceId: string | null = null;
    const invNumber = data.invoiceNumber || data.accountReference;

    const { data: invoice } = await supabase
      .from("business_invoices")
      .select("id")
      .eq("invoice_number", invNumber)
      .maybeSingle();

    if (invoice) {
      invoiceId = invoice.id;
    }

    const { error } = await supabase.from("business_payments").insert({
      payment_method: "stk_push",
      checkout_request_id: data.checkoutRequestId,
      merchant_request_id: data.merchantRequestId,
      invoice_number: invNumber,
      invoice_id: invoiceId,
      account_reference: data.accountReference,
      amount: data.amount,
      phone_number: data.phoneNumber,
      status: "pending",
    });

    if (error) {
      console.error("[SUPABASE RECORD STK ERROR]", error);
      throw error;
    }
  }

  /**
   * Updates STK payment to completed and reconciles the invoice
   */
  async handleStkSuccess(data: StkSuccessData) {
    const supabase = getSupabase();

    const { data: payment, error: fetchErr } = await supabase
      .from("business_payments")
      .select("*")
      .eq("checkout_request_id", data.checkoutRequestId)
      .maybeSingle();

    if (fetchErr || !payment) {
      console.warn(
        `[STK SUCCESS] No existing payment found for CheckoutRequestID: ${data.checkoutRequestId}`
      );
    }

    const invoiceNumber = payment?.invoice_number || payment?.account_reference;

    const { error: updateErr } = await supabase
      .from("business_payments")
      .update({
        status: "completed",
        mpesa_receipt_number: data.mpesaReceiptNumber,
        result_code: "0",
        result_desc: "The service request is processed successfully.",
        transaction_date: data.transactionDate.toISOString(),
        raw_callback: data.rawCallback,
      })
      .eq("checkout_request_id", data.checkoutRequestId);

    if (updateErr) {
      console.error("[SUPABASE UPDATE STK SUCCESS ERROR]", updateErr);
    }

    if (invoiceNumber && payment?.amount) {
      await this.reconcileInvoice(invoiceNumber, payment.amount);
    }
  }

  /**
   * Updates STK payment to failed
   */
  async handleStkFailure(data: StkFailureData) {
    const supabase = getSupabase();

    const { error } = await supabase
      .from("business_payments")
      .update({
        status: "failed",
        result_code: data.resultCode,
        result_desc: data.resultDesc,
        raw_callback: data.rawCallback,
      })
      .eq("checkout_request_id", data.checkoutRequestId);

    if (error) {
      console.error("[SUPABASE UPDATE STK FAILURE ERROR]", error);
    }
  }

  /**
   * Records a manual C2B Paybill payment and reconciles matching invoice
   */
  async handleC2bConfirmation(data: C2bConfirmationData) {
    const supabase = getSupabase();

    // Check if matching invoice exists by BillRefNumber
    let invoiceId: string | null = null;
    let paymentStatus = "unassigned";

    const { data: invoice } = await supabase
      .from("business_invoices")
      .select("id, amount, amount_paid")
      .eq("invoice_number", data.accountReference)
      .maybeSingle();

    if (invoice) {
      invoiceId = invoice.id;
      paymentStatus = "completed";
    }

    const { error } = await supabase.from("business_payments").insert({
      payment_method: "c2b_manual",
      mpesa_receipt_number: data.mpesaReceiptNumber,
      invoice_id: invoiceId,
      invoice_number: data.accountReference,
      account_reference: data.accountReference,
      amount: data.amount,
      phone_number: data.phoneNumber,
      payer_first_name: data.firstName || null,
      payer_middle_name: data.middleName || null,
      payer_last_name: data.lastName || null,
      status: paymentStatus,
      result_code: "0",
      result_desc: "C2B Payment Confirmed",
      transaction_date: data.transactionDate
        ? data.transactionDate.toISOString()
        : new Date().toISOString(),
      raw_callback: data.rawPayload,
    });

    if (error) {
      console.error("[SUPABASE RECORD C2B ERROR]", error);
      throw error;
    }

    if (invoice) {
      await this.reconcileInvoice(data.accountReference, data.amount);
    }
  }

  /**
   * Reconciles invoice balance
   */
  async reconcileInvoice(invoiceNumber: string, amountPaid: number) {
    const supabase = getSupabase();

    const { data: invoice } = await supabase
      .from("business_invoices")
      .select("id, amount, amount_paid")
      .eq("invoice_number", invoiceNumber)
      .maybeSingle();

    if (!invoice) return;

    const newAmountPaid = Number(invoice.amount_paid || 0) + Number(amountPaid);
    const isFullyPaid = newAmountPaid >= Number(invoice.amount);

    await supabase
      .from("business_invoices")
      .update({
        amount_paid: newAmountPaid,
        status: isFullyPaid ? "paid" : "partially_paid",
      })
      .eq("id", invoice.id);
  }

  /**
   * Get payment details by checkoutRequestId
   */
  async getPaymentByCheckoutId(checkoutRequestId: string) {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("business_payments")
      .select("*, business_invoices(*)")
      .eq("checkout_request_id", checkoutRequestId)
      .maybeSingle();
    return data;
  }
}

export const businessPaymentService = new BusinessPaymentService();
