import { config } from "../config";
import { HttpError } from "../middleware/error";

export type Sam3Request = Record<string, unknown>;

export const callSam3 = async (payload: Sam3Request) => {
  if (!config.sam3Endpoint) {
    throw new HttpError(500, "INTERNAL_ERROR", "SAM3_ENDPOINT not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.sam3TimeoutMs);

  try {
    const endpoint = config.sam3Endpoint.replace(/\/$/, "");
    const url = `${endpoint}/predictions/${config.sam3ModelName}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

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
        `SAM3 error: ${response.status}`
      );
    }

    return body;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if ((error as Error).name === "AbortError") {
      throw new HttpError(504, "INTERNAL_ERROR", "SAM3 request timeout");
    }
    throw new HttpError(500, "INTERNAL_ERROR", "SAM3 request failed");
  } finally {
    clearTimeout(timeout);
  }
};
