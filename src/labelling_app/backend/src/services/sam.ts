import { config } from "../config";
import { HttpError } from "../middleware/error";

export type SamRequest = Record<string, unknown>;

export const callSam = async (payload: SamRequest) => {
  if (!config.sam3Endpoint) {
    throw new HttpError(500, "INTERNAL_ERROR", "SAM endpoint not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.sam3TimeoutMs);

  try {
    const endpoint = config.sam3Endpoint.replace(/\/$/, "");
    const url = `${endpoint}/predictions/${config.sam3ModelName}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const retries = Math.max(0, config.sam3RetryCount);
    const retryDelayMs = Math.max(0, config.sam3RetryDelayMs);

    let response: Response | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        break;
      } catch (error) {
        lastError = error as Error;
        if ((error as Error).name === "AbortError") {
          throw error;
        }
        if (attempt >= retries) {
          break;
        }
        if (retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    if (!response) {
      throw lastError || new Error("SAM3 request failed");
    }

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (error) {
      body = text;
    }

    if (!response.ok) {
      throw new HttpError(
        response.status,
        "INTERNAL_ERROR",
        `SAM error: ${response.status}`
      );
    }

    return body;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if ((error as Error).name === "AbortError") {
      throw new HttpError(504, "INTERNAL_ERROR", "SAM request timeout");
    }
    const message =
      error instanceof Error && error.message
        ? `SAM request failed: ${error.message}`
        : "SAM request failed";
    throw new HttpError(500, "INTERNAL_ERROR", message);
  } finally {
    clearTimeout(timeout);
  }
};
