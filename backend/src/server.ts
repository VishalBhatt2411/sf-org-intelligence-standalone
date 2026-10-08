import "dotenv/config";
import "express-async-errors";
import express, { ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { authRouter } from "./routes/auth";
import { scansRouter } from "./routes/scans";
import { findingsRouter } from "./routes/findings";
import { connectionsRouter } from "./routes/connections";
import { graphRouter } from "./routes/graphDefault";
import { requireAuth } from "./middleware/requireAuth";
import { startScheduler } from "./services/scheduler";

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false });
app.use(apiLimiter);

app.use("/auth", authRouter);
app.use("/scans", requireAuth, scansRouter);
app.use("/findings", requireAuth, findingsRouter);
app.use("/connections/:connectionId/graph", requireAuth, graphRouter);
app.use("/connections", requireAuth, connectionsRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Safety net for anything a route handler didn't already catch itself (express-async-errors
// forwards thrown/rejected errors from async handlers here instead of crashing the process).
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend listening on :${port}`));
startScheduler();
