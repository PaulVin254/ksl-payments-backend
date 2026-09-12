import { supabaseAdmin } from "./supabase.js";
import { darajaService } from "./daraja.js";
import { handlePaymentSuccess } from "./postPayment.js";
import { mapMpesaResultCode } from "../utils/mpesaErrors.js";
import { logEvent } from "../index.js";
let isReconciling = false;
/**
 * Autonomous Background Reconciliation Worker
 * Sweeps the database every 2 minutes to rescue dropped webhooks
 * even if the student completely closed their browser tab.
 */
export async function runReconciliationSweep() {
    if (isReconciling)
        return;
    isReconciling = true;
    try {
        const now = Date.now();
        const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
        // Fetch pending transactions from the last 24 hours
        const { data: pendingRows, error } = await supabaseAdmin
            .from("payment_confirmations")
            .select("id, full_name, phone_number, email, amount_paid, checkout_request_id, created_at, status, payment_tier")
            .eq("status", "pending")
            .gte("created_at", oneDayAgo)
            .order("created_at", { ascending: true })
            .limit(20);
        if (error) {
            logEvent("WARN", "Reconciliation worker DB query error", error.message, "RECONCILER");
            return;
        }
        if (!pendingRows || pendingRows.length === 0) {
            return;
        }
        for (const row of pendingRows) {
            if (!row.checkout_request_id || !row.created_at)
                continue;
            const ageInSeconds = (now - new Date(row.created_at).getTime()) / 1000;
            // 1. If between 60s and 30m old: actively query Safaricom gateway
            if (ageInSeconds >= 60 && ageInSeconds <= 1800) {
                logEvent("INFO", `Reconciler checking pending transaction ${row.checkout_request_id} (Age: ${Math.round(ageInSeconds)}s)`, undefined, "RECONCILER");
                try {
                    const queryRes = await darajaService.queryStkStatus(row.checkout_request_id);
                    if (queryRes && queryRes.ResultCode !== undefined) {
                        const resCode = String(queryRes.ResultCode);
                        if (resCode === "0") {
                            logEvent("SUCCESS", `Reconciler verified payment for ${row.full_name} (${row.checkout_request_id})`, queryRes, "RECONCILER");
                            const { data: updated } = await supabaseAdmin
                                .from("payment_confirmations")
                                .update({
                                status: "verified",
                                result_code: 0,
                                result_desc: queryRes.ResultDesc || "Confirmed via background worker",
                                admin_notes: `Auto-reconciled by server background worker at ${new Date().toISOString()}`,
                            })
                                .eq("checkout_request_id", row.checkout_request_id)
                                .select()
                                .single();
                            if (updated) {
                                handlePaymentSuccess({
                                    id: updated.id,
                                    full_name: updated.full_name,
                                    phone_number: updated.phone_number,
                                    email: updated.email,
                                    amount_paid: updated.amount_paid,
                                    mpesa_receipt: updated.mpesa_receipt || "CONFIRMED",
                                    payment_tier: updated.payment_tier,
                                }).catch((err) => logEvent("ERROR", "Reconciler automation error", err.message, "RECONCILER"));
                            }
                        }
                        else if (["1032", "1", "1037", "2001", "1019"].includes(resCode)) {
                            const mapped = mapMpesaResultCode(resCode, queryRes.ResultDesc);
                            logEvent("WARN", `Reconciler confirmed failure (${mapped.category}) for ${row.checkout_request_id}`, queryRes, "RECONCILER");
                            await supabaseAdmin
                                .from("payment_confirmations")
                                .update({
                                status: "failed",
                                result_code: mapped.code,
                                result_desc: queryRes.ResultDesc,
                                failure_reason: mapped.userMessage,
                                admin_notes: `Failed via Reconciler STK Query: ${queryRes.ResultDesc} [${mapped.category}]`,
                            })
                                .eq("checkout_request_id", row.checkout_request_id);
                        }
                    }
                }
                catch (err) {
                    logEvent("WARN", `Error querying STK status for ${row.checkout_request_id}`, err.message, "RECONCILER");
                }
            }
            // 2. If older than 30 minutes without confirmation: mark expired
            else if (ageInSeconds > 1800) {
                logEvent("INFO", `Auto-expiring stale pending payment for ${row.full_name} (${row.checkout_request_id})`, undefined, "RECONCILER");
                await supabaseAdmin
                    .from("payment_confirmations")
                    .update({
                    status: "expired",
                    admin_notes: `Auto-expired after 30 minutes with no confirmation at ${new Date().toISOString()}`,
                })
                    .eq("checkout_request_id", row.checkout_request_id);
            }
        }
    }
    catch (err) {
        logEvent("ERROR", "Unhandled error in reconciliation sweep", err.message, "RECONCILER");
    }
    finally {
        isReconciling = false;
    }
}
/**
 * Starts the recurring 2-minute background reconciler loop.
 */
export function startReconciliationWorker(intervalMs = 120 * 1000) {
    logEvent("INFO", `Reconciliation worker started (sweeping every ${intervalMs / 1000}s)`, undefined, "SYSTEM");
    // Initial sweep 15s after startup
    setTimeout(() => runReconciliationSweep(), 15000);
    // Recurring sweep
    setInterval(() => runReconciliationSweep(), intervalMs);
}
