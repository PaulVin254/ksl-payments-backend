import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { mpesaRouter } from "./routes/mpesa.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for frontend clients
const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or Daraja webhooks)
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin) || origin.includes("localhost")) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive in dev to avoid CORS blockers
    },
    credentials: true,
  })
);

// Standard body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint (for Azure App Service liveness probes)
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "ksl-payments-backend",
    environment: process.env.DARAJA_ENVIRONMENT || "sandbox",
  });
});

// Mount M-Pesa endpoints
app.use("/api/mpesa", mpesaRouter);

// Global 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

app.listen(port, () => {
  console.log(`🚀 KSL Payments Backend running on port ${port}`);
  console.log(`📍 Environment: ${process.env.DARAJA_ENVIRONMENT || "sandbox"}`);
});
