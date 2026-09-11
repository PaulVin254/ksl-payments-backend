import dotenv/config;
import axios from axios;

const consumerKey = process.env.DARAJA_CONSUMER_KEY?.trim();
const consumerSecret = process.env.DARAJA_CONSUMER_SECRET?.trim();
const env = process.env.DARAJA_ENVIRONMENT || sandbox;

console.log(Checking Daraja credentials...);
console.log(Consumer Key exists:, Boolean(consumerKey), Length:, consumerKey?.length);
console.log(Consumer Secret exists:, Boolean(consumerSecret), Length:, consumerSecret?.length);

const auth = Buffer.from(${consumerKey}:).toString(base64);
const url = https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials;

try {
  const res = await axios.get(url, {
    headers: { Authorization: Basic  },
    timeout: 10000,
  });
  console.log(SUCCESS! Got Daraja OAuth token:, res.data.access_token.slice(0, 15) + ...);
} catch (e) {
  console.error(FAILED to get Daraja OAuth token:, e.response?.data || e.message);
}
