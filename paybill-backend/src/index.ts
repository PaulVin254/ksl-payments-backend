import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { mpesaRouter } from "./routes/mpesa.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS setup
const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Allow all in dev/staging or restrict if needed
      }
    },
    credentials: true,
  })
);

// Standard JSON parser
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[HTTP] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`
    );
  });
  next();
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "business-paybill-backend",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

// Mount payment routes (avoiding the word 'mpesa' in callback URLs per Safaricom requirement)
app.use("/api/payments", mpesaRouter);
app.use("/api/mpesa", mpesaRouter);

// Global 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("[GLOBAL ERROR]", err);
  res.status(500).json({
    error: err.message || "Internal server error",
  });
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  Registered Business Paybill Backend Live!`);
  console.log(`  Listening on Port: ${PORT}`);
  console.log(`  Daraja Environment: ${process.env.DARAJA_ENVIRONMENT || "sandbox"}`);
  console.log(`  Paybill Number: ${process.env.DARAJA_PAYBILL_NUMBER || "174379"}`);
  console.log(`====================================================`);
});
