"use client";

import { useState, useRef, useEffect } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  responseTimeMs?: number;
};

const MODELS = [
  { value: "gpt-5.2", label: "GPT-5.2" },
  { value: "gpt-5-mini", label: "GPT-5 Mini" },
  { value: "gpt-5-nano", label: "GPT-5 Nano" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
];

const MODELS_WITH_WEB_SEARCH = ["gpt-5.2", "gpt-5-mini", "gpt-5-nano", "gpt-4o", "gpt-4o-mini"];

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(MODELS[0].value);
  const [isLoading, setIsLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const formatErrorMessage = async (response: Response): Promise<string> => {
    try {
      const errorData = await response.json();
      const errorType = errorData.errorType || "unknown_error";
      const error = errorData.error || "An unknown error occurred";
      const details = errorData.details ? `\n\nDetails: ${errorData.details}` : "";

      // Format based on error type
      if (errorType === "authentication_error" || errorType === "api_key_error") {
        return `🔑 Authentication Error\n\n${error}${details}\n\nPlease check your OPENAI_API_KEY environment variable.`;
      }

      if (errorType === "rate_limit_error") {
        return `⏱️ Rate Limit Exceeded\n\n${error}${details}`;
      }

      if (errorType === "network_error" || errorType === "timeout_error") {
        return `🌐 Network Error\n\n${error}${details}\n\nPlease check your internet connection and try again.`;
      }

      if (errorType === "openai_server_error") {
        return `⚠️ OpenAI Service Error\n\n${error}${details}\n\nThe OpenAI API service may be experiencing issues. Please try again in a moment.`;
      }

      if (errorType === "validation_error") {
        return `❌ Validation Error\n\n${error}${details}`;
      }

      return `❌ Error (${errorType})\n\n${error}${details}`;
    } catch (parseError) {
      // If we can't parse the error response, return a generic message with status
      return `❌ Server Error\n\nReceived HTTP ${response.status}: ${response.statusText}\n\nThe server returned an error, but we couldn't parse the error details.`;
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Add placeholder assistant message
    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
    };
    setMessages((prev) => [...prev, assistantMessage]);

    const startTime = performance.now();

    try {
      let response: Response;
      try {
        response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [...messages, userMessage].map(({ role, content }) => ({
              role,
              content,
            })),
            model,
            useWebSearch: useWebSearch && MODELS_WITH_WEB_SEARCH.includes(model),
          }),
        });
      } catch (fetchError) {
        // Handle network errors (no response received)
        const endTime = performance.now();
        const responseTimeMs = Math.round(endTime - startTime);
        const errorMessage =
          fetchError instanceof TypeError && fetchError.message.includes("fetch")
            ? `🌐 Network Connection Error\n\nUnable to connect to the server. This could mean:\n\n• The server is not running (check if you started the dev server with 'npm run dev')\n• There's a network connectivity issue\n• The request was blocked (check browser console for CORS errors)\n\nError: ${fetchError.message}`
            : `❌ Request Failed\n\nFailed to send request to server.\n\nError: ${fetchError instanceof Error ? fetchError.message : "Unknown error"}`;

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: errorMessage, responseTimeMs }
              : msg
          )
        );
        return;
      }

      // Handle non-OK responses
      if (!response.ok) {
        const endTime = performance.now();
        const responseTimeMs = Math.round(endTime - startTime);
        const errorMessage = await formatErrorMessage(response);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: errorMessage, responseTimeMs }
              : msg
          )
        );
        return;
      }

      // Handle streaming response
      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error("No response body: The server did not return a readable stream.");
      }

      const decoder = new TextDecoder();
      let accumulatedContent = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          accumulatedContent += chunk;

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, content: accumulatedContent }
                : msg
            )
          );
        }
        
        // Calculate and store response time when stream completes
        const endTime = performance.now();
        const responseTimeMs = Math.round(endTime - startTime);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, responseTimeMs }
              : msg
          )
        );
      } catch (streamError) {
        // Handle stream reading errors
        const endTime = performance.now();
        const responseTimeMs = Math.round(endTime - startTime);
        const streamErrorMessage = `❌ Stream Reading Error\n\nFailed to read the streaming response.\n\nError: ${streamError instanceof Error ? streamError.message : "Unknown stream error"}\n\nPartial response received: ${accumulatedContent || "(none)"}`;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: streamErrorMessage, responseTimeMs }
              : msg
          )
        );
      }
    } catch (error) {
      // Catch-all for any other errors
      const endTime = performance.now();
      const responseTimeMs = Math.round(endTime - startTime);
      console.error("Error sending message:", error);
      const errorMessage = `❌ Unexpected Error\n\nAn unexpected error occurred while processing your request.\n\nError: ${error instanceof Error ? error.message : "Unknown error"}\n\nPlease check the browser console for more details.`;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, content: errorMessage, responseTimeMs }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getPreviewPayload = () => {
    const previewMessages = [...messages];
    
    // If there's text in the input, include it as a user message in the preview
    if (input.trim()) {
      previewMessages.push({
        id: "preview-user",
        role: "user",
        content: input.trim(),
      });
    }

    // Convert messages to input format (as it will be sent to Responses API)
    const inputArray = previewMessages.map(({ role, content }) => ({
      role,
      content,
    }));

    const payload: {
      model: string;
      stream: boolean;
      input: Array<{ role: string; content: string }>;
      tools?: Array<{ type: string }>;
    } = {
      model,
      stream: true,
      input: inputArray,
    };

    // Add web search tool if enabled and model supports it
    if (useWebSearch && MODELS_WITH_WEB_SEARCH.includes(model)) {
      payload.tools = [{ type: "web_search" }];
    }

    return payload;
  };

  const copyPreviewToClipboard = async () => {
    try {
      const payload = getPreviewPayload();
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      alert("Preview copied to clipboard!");
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const formatResponseTime = (ms: number): string => {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    const seconds = (ms / 1000).toFixed(1);
    return `${seconds}s`;
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Preview Prompt Button */}
      <div className="absolute top-4 left-4 z-10">
        <button
          onClick={() => setShowPreview(true)}
          className="px-4 py-2 bg-gray-700 text-white text-sm rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
        >
          Preview Prompt
        </button>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-800">
                Prompt Preview
              </h2>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 rounded p-1"
                aria-label="Close"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">
                  This is the exact payload that will be sent to the OpenAI API:
                </p>
              </div>
              <pre className="bg-gray-50 border border-gray-200 rounded p-4 overflow-x-auto text-sm">
                <code>{JSON.stringify(getPreviewPayload(), null, 2)}</code>
              </pre>
              {messages.length === 0 && !input.trim() && (
                <p className="text-sm text-amber-600 mt-4">
                  ⚠️ No messages yet. The payload above includes only the model selection.
                </p>
              )}
              {input.trim() && (
                <p className="text-sm text-blue-600 mt-4">
                  ℹ️ The current input text is included in the preview above as a user message.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
              <button
                onClick={copyPreviewToClipboard}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
              >
                Copy JSON
              </button>
              <button
                onClick={() => setShowPreview(false)}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-8">
          {/* Model Picker */}
          <div className="mb-6 space-y-4">
            <div>
              <label
                htmlFor="model-select"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Model
              </label>
              <select
                id="model-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                {MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            {/* Web Search Toggle */}
            {MODELS_WITH_WEB_SEARCH.includes(model) && (
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="web-search-toggle"
                  checked={useWebSearch}
                  onChange={(e) => setUseWebSearch(e.target.checked)}
                  disabled={isLoading}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
                <label
                  htmlFor="web-search-toggle"
                  className="ml-2 block text-sm text-gray-700"
                >
                  Enable Web Search
                  <span className="text-xs text-gray-500 ml-1">
                    (Allows model to search the web for current information)
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-gray-500 mt-12">
                Start a conversation by typing a message below.
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                } items-end gap-2`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    message.role === "user"
                      ? "bg-blue-500 text-white"
                      : "bg-white text-gray-800 border border-gray-200"
                  }`}
                >
                  <div className="whitespace-pre-wrap break-words">
                    {message.content || (isLoading && message.role === "assistant" ? "Thinking..." : "")}
                  </div>
                </div>
                {message.role === "assistant" && message.responseTimeMs !== undefined && (
                  <div className="text-xs text-gray-400 pb-1">
                    {formatResponseTime(message.responseTimeMs)}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-200 bg-white">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message... (Enter to send, Shift+Enter for newline)"
              disabled={isLoading}
              rows={1}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              style={{ minHeight: "44px", maxHeight: "200px" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
              }}
            />
            <button
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
              className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

