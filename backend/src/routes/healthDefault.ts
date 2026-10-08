import { healthService } from "../health/defaultHealthService";
import { createHealthRouter } from "./health";

// Production wiring for the health routes; tests build their own router with fakes.
export const healthRouter = createHealthRouter({ service: healthService });
