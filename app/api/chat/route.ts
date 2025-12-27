import { openai } from "@/lib/openai";
import { NextRequest } from "next/server";
import OpenAI from "openai";

interface ErrorResponse {
  error: string;
  errorType: string;
  details?: string;
}

function createErrorResponse(
  error: string,
  errorType: string,
  details?: string,
  status: number = 500
): Response {
  const response: ErrorResponse = { error, errorType };
  if (details) {
    response.details = details;
  }
  return new Response(JSON.stringify(response), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseOpenAIError(error: unknown): { message: string; type: string; status: number } {
  if (error instanceof OpenAI.APIError) {
    // Handle OpenAI API errors
    const status = error.status || 500;
    let message = error.message;
    let type = "openai_api_error";

    if (status === 401) {
      type = "authentication_error";
      message = "Invalid OpenAI API key. Please check that OPENAI_API_KEY is set correctly in your environment variables.";
    } else if (status === 429) {
      type = "rate_limit_error";
      message = "OpenAI API rate limit exceeded. Please wait a moment and try again.";
    } else if (status === 500 || status === 502 || status === 503) {
      type = "openai_server_error";
      message = `OpenAI API server error (${status}). The OpenAI service may be experiencing issues. Please try again later.`;
    } else if (status === 400) {
      type = "invalid_request_error";
      message = `Invalid request to OpenAI API: ${error.message}`;
    }

    return { message, type, status };
  }

  if (error instanceof Error) {
    // Check for common error patterns
    const errorMessage = error.message.toLowerCase();

    if (errorMessage.includes("api key") || errorMessage.includes("openai_api_key")) {
      return {
        message: "OpenAI API key is missing or invalid. Please check your environment variables.",
        type: "api_key_error",
        status: 500,
      };
    }

    if (errorMessage.includes("network") || errorMessage.includes("fetch") || errorMessage.includes("connection")) {
      return {
        message: "Network error: Unable to connect to OpenAI API. Please check your internet connection and try again.",
        type: "network_error",
        status: 503,
      };
    }

    if (errorMessage.includes("timeout")) {
      return {
        message: "Request timeout: The request to OpenAI API took too long. Please try again.",
        type: "timeout_error",
        status: 504,
      };
    }

    return {
      message: error.message,
      type: "unknown_error",
      status: 500,
    };
  }

  return {
    message: "An unexpected error occurred while processing your request.",
    type: "unknown_error",
    status: 500,
  };
}

export async function POST(req: NextRequest) {
  try {
    // Parse request body
    let body;
    try {
      body = await req.json();
    } catch (error) {
      return createErrorResponse(
        "Invalid request body: Unable to parse JSON.",
        "invalid_request",
        error instanceof Error ? error.message : "Unknown parsing error",
        400
      );
    }

    const { messages, model, useWebSearch, systemPrompt } = body;

    // Validate messages
    if (!messages) {
      return createErrorResponse(
        "Missing required field: 'messages' is required in the request body.",
        "validation_error",
        undefined,
        400
      );
    }

    if (!Array.isArray(messages)) {
      return createErrorResponse(
        "Invalid field type: 'messages' must be an array.",
        "validation_error",
        `Received type: ${typeof messages}`,
        400
      );
    }

    if (messages.length === 0) {
      return createErrorResponse(
        "Empty messages array: At least one message is required.",
        "validation_error",
        undefined,
        400
      );
    }

    // Validate model
    if (!model) {
      return createErrorResponse(
        "Missing required field: 'model' is required in the request body.",
        "validation_error",
        undefined,
        400
      );
    }

    if (typeof model !== "string") {
      return createErrorResponse(
        "Invalid field type: 'model' must be a string.",
        "validation_error",
        `Received type: ${typeof model}`,
        400
      );
    }

    // Initialize OpenAI Responses API stream
    let responseStream;
    try {
      // Check if responses API is available
      if (!openai.responses || typeof openai.responses.create !== "function") {
        throw new Error(
          "Responses API is not available in this SDK version. Please upgrade to OpenAI SDK v5.0.0 or later."
        );
      }

      // Build input messages array
      // Check if messages already contains a system message
      const hasSystemMessage = messages.some((m: { role: string }) => m.role === "system");
      
      // If systemPrompt is provided and there's no system message in messages, prepend it
      // Otherwise, use the system message from messages array
      const inputMessages = [
        systemPrompt && !hasSystemMessage
          ? { role: "system" as const, content: systemPrompt }
          : null,
        ...messages.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
      ].filter(Boolean) as Array<{ role: "user" | "assistant" | "system"; content: string }>;

      responseStream = await openai.responses.create({
        model,
        stream: true,
        input: inputMessages,
        ...(useWebSearch
          ? {
              tools: [
                {
                  type: "web_search",
                },
              ],
            }
          : {}),
      });
    } catch (error) {
      console.error("OpenAI API initialization error:", error);
      const parsedError = parseOpenAIError(error);
      
      // Provide helpful error message if Responses API is not available
      if (error instanceof Error && error.message.includes("Responses API")) {
        return createErrorResponse(
          `Responses API Error: ${error.message}. Please upgrade the OpenAI SDK: npm install openai@latest`,
          "api_not_available",
          error.stack,
          501
        );
      }
      
      return createErrorResponse(
        `Failed to create response: ${parsedError.message}`,
        parsedError.type,
        error instanceof Error ? error.stack : undefined,
        parsedError.status
      );
    }

    // Create streaming response for Responses API events
    const encoder = new TextEncoder();
    let eventCount = 0;
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of responseStream) {
            eventCount++;
            
            // Log first 3 events to understand the structure (remove in production)
            if (eventCount <= 3) {
              console.log(`Event ${eventCount} structure:`, JSON.stringify(event, null, 2));
            }

            // Extract text delta - try structures in order of likelihood
            // Only extract once per event to avoid duplicates
            // IMPORTANT: Only process delta events, not full text events
            let textDelta: string | null = null;
            
            // Skip non-delta events (like completion events that might contain full text)
            const eventType = (event as any).type;
            if (eventType && !eventType.includes("delta") && !eventType.includes("text")) {
              // Skip non-text events
              continue;
            }

            // Structure 1: event.output[0].content[0] with type "output_text_delta" (most likely)
            // This is the primary structure for Responses API streaming
            const output = (event as any).output?.[0];
            const part = output?.content?.[0];
            
            if (part?.type === "output_text_delta" && part.delta) {
              textDelta = typeof part.delta === "string" ? part.delta : part.delta.text || null;
            }

            // Structure 2: Direct event type check (alternative format)
            if (!textDelta && (event as any).type === "response.output_text.delta") {
              const delta = (event as any).delta || (event as any).text;
              textDelta = typeof delta === "string" ? delta : null;
            }

            // Structure 3: Check for delta property directly (only if it's a delta event)
            if (!textDelta && (event as any).delta && typeof (event as any).delta === "string") {
              // Only use if this is clearly a delta event, not a full text event
              textDelta = (event as any).delta;
            }

            // Skip checking output_text, content, or other properties that might contain full accumulated text
            // We only want incremental deltas, not full text

            // Send text delta only once per event
            if (textDelta && textDelta.length > 0) {
              controller.enqueue(encoder.encode(textDelta));
            } else if (eventCount <= 5) {
              // Log unhandled events for debugging (first 5 only)
              console.log(`Unhandled event ${eventCount}:`, Object.keys(event as any));
            }
          }
          
          if (eventCount === 0) {
            console.warn("No events received from Responses API stream");
          }
          
          controller.close();
        } catch (error) {
          console.error("Stream processing error:", error);
          const parsedError = parseOpenAIError(error);
          const errorText = encoder.encode(
            `\n\n[Error: ${parsedError.message}]`
          );
          controller.enqueue(errorText);
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    const parsedError = parseOpenAIError(error);
    return createErrorResponse(
      `Request processing failed: ${parsedError.message}`,
      parsedError.type,
      error instanceof Error ? error.stack : undefined,
      parsedError.status
    );
  }
}

