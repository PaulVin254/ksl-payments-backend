/**
 * M-Pesa Result Code Dictionary & Categorization
 * Maps Safaricom Daraja numeric ResultCodes to structured categories,
 * clear diagnostic reasons, and user-friendly, actionable recovery messages.
 */
export function mapMpesaResultCode(resultCode, resultDesc) {
    const code = typeof resultCode === "string" ? parseInt(resultCode, 10) : Number(resultCode ?? -1);
    switch (code) {
        case 0:
            return {
                code: 0,
                category: "SUCCESS",
                failureReason: "Payment completed successfully",
                userMessage: "Payment confirmed successfully! Welcome aboard.",
                canRetry: false,
            };
        case 1032:
            return {
                code: 1032,
                category: "USER_CANCELLED",
                failureReason: "Transaction cancelled by user on mobile handset",
                userMessage: "You cancelled the payment prompt on your phone. You can try again whenever you are ready.",
                canRetry: true,
            };
        case 1037:
            return {
                code: 1037,
                category: "TIMEOUT",
                failureReason: "USSD / SIM toolkit prompt timed out on user phone",
                userMessage: "The M-Pesa prompt timed out before your PIN was entered. Please keep your phone unlocked and try again.",
                canRetry: true,
            };
        case 1019:
            return {
                code: 1019,
                category: "TIMEOUT",
                failureReason: "Transaction expired on Safaricom gateway",
                userMessage: "The transaction took too long to confirm. Please check your phone coverage and try again.",
                canRetry: true,
            };
        case 1:
            return {
                code: 1,
                category: "INSUFFICIENT_FUNDS",
                failureReason: "Insufficient funds in user M-Pesa wallet",
                userMessage: "Your M-Pesa balance was insufficient for this transaction. Please top up your wallet and try again.",
                canRetry: true,
            };
        case 2001:
            return {
                code: 2001,
                category: "AUTH_ERROR",
                failureReason: "Invalid M-Pesa PIN entered on phone",
                userMessage: "An incorrect M-Pesa PIN was entered on your phone. Please try again with your correct PIN.",
                canRetry: true,
            };
        case 1001:
            return {
                code: 1001,
                category: "SYSTEM_BUSY",
                failureReason: "Another transaction is currently in progress on this mobile number",
                userMessage: "Another M-Pesa transaction is currently active on your phone. Please wait a moment for it to complete and retry.",
                canRetry: true,
            };
        case 9999:
        case -1:
            return {
                code: code,
                category: "FAILED",
                failureReason: resultDesc || "M-Pesa transaction timed out without confirmation",
                userMessage: "We could not reach your phone. Please verify your number has active cellular reception and try again.",
                canRetry: true,
            };
        default:
            return {
                code: isNaN(code) ? -1 : code,
                category: "FAILED",
                failureReason: resultDesc || `Transaction failed with M-Pesa code ${code}`,
                userMessage: resultDesc
                    ? `M-Pesa was unable to complete the payment: ${resultDesc}. Please try again.`
                    : "Payment could not be completed. Please check your phone and try again.",
                canRetry: true,
            };
    }
}
