import { sendWelcomeEmail } from "./brevo.js";
import { sendWhatsAppMessage } from "./whatsapp.js";
import { logEvent } from "../index.js";
/**
 * Handles decoupled post-payment automations.
 * Brevo email and Meta WhatsApp message run in isolated, resilient try/catch blocks.
 * Failure in one notification channel will NEVER break or block the other.
 */
export async function handlePaymentSuccess(record) {
    const groupLink = process.env.WHATSAPP_CLASS_GROUP_LINK || "https://chat.whatsapp.com/JHAPRzElBgQIUhwjHfxkP8";
    logEvent("INFO", `Starting post-payment automations for ${record.full_name} (Receipt: ${record.mpesa_receipt})`, {
        student: record.full_name,
        receipt: record.mpesa_receipt,
        email: record.email,
        phone: record.phone_number,
    }, "AUTOMATIONS");
    // 1. Transactional Welcome Email via Brevo
    if (record.email) {
        try {
            const emailSent = await sendWelcomeEmail({
                studentName: record.full_name,
                studentEmail: record.email,
                amountPaid: record.amount_paid,
                mpesaReceipt: record.mpesa_receipt,
                paymentTier: record.payment_tier || "full",
                whatsAppGroupLink: groupLink,
            });
            if (emailSent) {
                logEvent("SUCCESS", `Welcome email sent successfully to ${record.email}`, undefined, "BREVO");
            }
            else {
                logEvent("WARN", `Welcome email skipped or unconfigured for ${record.email}`, undefined, "BREVO");
            }
        }
        catch (err) {
            logEvent("ERROR", `Failed to send welcome email to ${record.email}`, err.message, "BREVO");
        }
    }
    else {
        logEvent("INFO", "No email provided for student; skipping email automation", undefined, "BREVO");
    }
    // 2. WhatsApp Notification via Meta Cloud API (Feature-Flagged)
    const isWhatsAppEnabled = process.env.ENABLE_WHATSAPP === "true";
    if (!isWhatsAppEnabled) {
        logEvent("INFO", "WhatsApp notification skipped (ENABLE_WHATSAPP is false or not set)", undefined, "WHATSAPP");
        return;
    }
    if (record.phone_number) {
        try {
            const waSent = await sendWhatsAppMessage({
                phoneNumber: record.phone_number,
                studentName: record.full_name,
                amountPaid: record.amount_paid,
                mpesaReceipt: record.mpesa_receipt,
                whatsAppGroupLink: groupLink,
            });
            if (waSent) {
                logEvent("SUCCESS", `WhatsApp message dispatched to ${record.phone_number}`, undefined, "WHATSAPP");
            }
            else {
                logEvent("WARN", `WhatsApp message delivery unconfirmed for ${record.phone_number}`, undefined, "WHATSAPP");
            }
        }
        catch (err) {
            logEvent("ERROR", `WhatsApp delivery error for ${record.phone_number}`, err.message, "WHATSAPP");
        }
    }
}
