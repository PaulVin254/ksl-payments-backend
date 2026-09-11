import axios from "axios";
export async function sendWhatsAppMessage(params) {
    const token = process.env.WHATSAPP_API_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "1104790996054118";
    if (!token) {
        console.warn("⚠️ Warning: WHATSAPP_API_TOKEN not set. Skipping WhatsApp message.");
        return false;
    }
    const firstName = params.studentName.trim().split(" ")[0] || "there";
    const cleanPhone = params.phoneNumber.replace(/\+/g, "").trim();
    const messageBody = `Jambo ${firstName}! 🎉\n\nYour KSL Bridge Builder payment of Ksh ${params.amountPaid.toLocaleString()} is confirmed!\n\n📋 M-Pesa Receipt: ${params.mpesaReceipt}\n\n👉 Click here to join your class WhatsApp group:\n${params.whatsAppGroupLink}\n\nSee you inside! — Paul, Ephphatha Sign Language`;
    const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanPhone,
        type: "text",
        text: {
            body: messageBody,
        },
    };
    try {
        const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        });
        console.log("✅ Meta WhatsApp message sent successfully to", cleanPhone, response.data);
        return true;
    }
    catch (error) {
        console.error("❌ Failed to send WhatsApp message:", error.response?.data || error.message);
        return false;
    }
}
