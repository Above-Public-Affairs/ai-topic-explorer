/**
 * Provider failures built with each SDK's own error classes, from recorded
 * error bodies, so the classifiers see what they see in production.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { ApiError } from "@google/genai";
import { json } from "./fixtures";

export function openaiError(status: number, body: object, headers: Record<string, string> = {}) {
  return OpenAI.APIError.generate(status, body, undefined, new Headers(headers));
}

export function anthropicError(status: number, type: string, message: string, headers: Record<string, string> = {}) {
  return Anthropic.APIError.generate(
    status,
    { type: "error", error: { type, message } },
    undefined,
    new Headers(headers)
  );
}

/** A Gemini ApiError carrying a recorded body from tests/fixtures/errors. */
export function geminiError(status: number, fixture: string, { stream = false } = {}) {
  const body = JSON.stringify(json(`errors/${fixture}.json`));
  // Stream failures prefix the body with the HTTP status line.
  return new ApiError({ status, message: stream ? `got status: ${status} . ${body}` : body });
}
