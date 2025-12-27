"use client";

import { useState, useRef, useEffect } from "react";
import { BotConfig, DEFAULT_BOTS } from "@/lib/bots";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  botId?: string; // set only for assistant messages
  content: string;
  createdAt: number;
  responseTimeMs?: number;
};

// Simple ID generator
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

type BotEditState = {
  id: string | null;
  name: string;
  personality: string;
  description: string;
  model: string;
  useWebSearch: boolean;
  rules: string;
};

export default function Home() {
  const [bots, setBots] = useState<BotConfig[]>(DEFAULT_BOTS);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showBotManager, setShowBotManager] = useState(false);
  const [editingBot, setEditingBot] = useState<BotEditState | null>(null);
  const [globalRules, setGlobalRules] = useState<string>(
    DEFAULT_BOTS[0]?.rules || "Provide a short, succinct and casual response."
  );
  const [nextBotIndex, setNextBotIndex] = useState<number>(0);
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

  // Helper function to build the conversation context system message
  const buildConversationContext = (
    bot: BotConfig,
    allBots: BotConfig[]
  ): string => {
    // Build list of all bot names
    const botNames = allBots.map(b => b.name).join(", ");
    
    // Build description of the bot
    const botDescription = bot.description || `a participant named ${bot.name}`;
    
    // Build personality text
    const personalityText = bot.personality 
      ? ` Your personality is: ${bot.personality}.`
      : "";
    
    return `This is a multi-user conversation between ${botNames} and the user. You are ${bot.name}, ${botDescription}.${personalityText}`;
  };

  // Helper function to build the turn instruction system message
  const buildTurnInstruction = (bot: BotConfig): string => {
    // Use global rules if available, otherwise fall back to bot-specific rules
    const rulesToUse = globalRules || bot.rules || "";
    const rulesText = rulesToUse 
      ? ` ${rulesToUse}`
      : "";
    
    return `${bot.name}, it is your turn to respond now. Your response will be added to the conversation log and then someone else will respond.${rulesText}`;
  };

  // Helper function to get speaker label for a message
  // Each message has its author stored: user messages have role="user",
  // assistant messages have botId pointing to the bot that authored them
  const getSpeakerLabel = (msg: ChatMessage): string => {
    if (msg.role === "user") return "User";
    if (msg.role === "assistant" && msg.botId) {
      const bot = bots.find((b) => b.id === msg.botId);
      if (bot) return bot.name; // e.g. "Upside", "Downside", "Missing Pieces"
    }
    return "Assistant";
  };

  // Helper function to strip bot name prefix from response
  // Removes patterns like "Bot-1: " or "Bot-1:" from the start of the response
  const stripBotNamePrefix = (content: string, botName: string): string => {
    // Check for "BotName: " or "BotName:" at the start
    const prefix1 = `${botName}: `;
    const prefix2 = `${botName}:`;
    
    if (content.startsWith(prefix1)) {
      return content.slice(prefix1.length).trimStart();
    }
    if (content.startsWith(prefix2)) {
      return content.slice(prefix2.length).trimStart();
    }
    
    return content;
  };

  const streamBotReply = async (
    bot: BotConfig,
    botMessageId: string,
    history: ChatMessage[],
  ): Promise<string> => {
    const startTime = performance.now();
    
    // Build the message array with proper role structure:
    // 1. System message with conversation context
    // 2. Array of conversation history messages (user and assistant)
    // 3. Final system message with turn instruction
    
    const conversationContext = buildConversationContext(bot, bots);
    const turnInstruction = buildTurnInstruction(bot);
    
    // Convert history to API format with proper roles
    const historyMessages = history.map((msg) => {
      const speaker = getSpeakerLabel(msg);
      // For assistant messages, we label them with the bot name
      // For user messages, we keep them as user role
      if (msg.role === "user") {
        return {
          role: "user" as const,
          content: `${speaker}: ${msg.content}`,
        };
      } else {
        // Assistant messages from other bots
        return {
          role: "assistant" as const,
          content: `${speaker}: ${msg.content}`,
        };
      }
    });
    
    // Build the complete message array
    const apiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content: conversationContext,
      },
      ...historyMessages,
      {
        role: "system",
        content: turnInstruction,
      },
    ];

    try {
      let response: Response;
      try {
        response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: apiMessages,
            model: bot.model,
            useWebSearch: bot.useWebSearch,
            // Don't pass systemPrompt separately since we're using messages array
          }),
        });
      } catch (fetchError) {
        const endTime = performance.now();
        const responseTimeMs = Math.round(endTime - startTime);
        const errorMessage =
          fetchError instanceof TypeError && fetchError.message.includes("fetch")
            ? `🌐 Network Connection Error\n\nUnable to connect to the server.`
            : `❌ Request Failed\n\nError: ${fetchError instanceof Error ? fetchError.message : "Unknown error"}`;

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMessageId
              ? { ...msg, content: errorMessage, responseTimeMs }
              : msg
          )
        );
        return errorMessage;
      }

      if (!response.ok || !response.body) {
        const endTime = performance.now();
        const responseTimeMs = Math.round(endTime - startTime);
        const errorMessage = await formatErrorMessage(response);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMessageId
              ? { ...msg, content: errorMessage, responseTimeMs }
              : msg
          )
        );
        return errorMessage;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value || new Uint8Array(), { stream: true });
          if (!chunk) continue;

          accumulatedContent += chunk;

          // Strip bot name prefix from accumulated content for display
          const cleanedContent = stripBotNamePrefix(accumulatedContent, bot.name);

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === botMessageId
                ? { ...msg, content: cleanedContent }
                : msg
            )
          );
        }

        // Calculate and store response time when stream completes
        const endTime = performance.now();
        const responseTimeMs = Math.round(endTime - startTime);
        
        // Final cleanup: strip bot name prefix from the complete response
        const finalContent = stripBotNamePrefix(accumulatedContent, bot.name);
        
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMessageId
              ? { ...msg, content: finalContent, responseTimeMs }
              : msg
          )
        );
        
        return finalContent;
      } catch (streamError) {
        const endTime = performance.now();
        const responseTimeMs = Math.round(endTime - startTime);
        const streamErrorMessage = `❌ Stream Reading Error\n\nFailed to read the streaming response.\n\nError: ${streamError instanceof Error ? streamError.message : "Unknown stream error"}`;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMessageId
              ? { ...msg, content: streamErrorMessage, responseTimeMs }
              : msg
          )
        );
        return streamErrorMessage;
      }
    } catch (error) {
      const endTime = performance.now();
      const responseTimeMs = Math.round(endTime - startTime);
      console.error("Error streaming bot reply:", error);
      const errorMessage = `❌ Unexpected Error\n\nAn unexpected error occurred.\n\nError: ${error instanceof Error ? error.message : "Unknown error"}`;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === botMessageId
            ? { ...msg, content: errorMessage, responseTimeMs }
            : msg
        )
      );
      return errorMessage;
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading || isResponding) return;

    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: input.trim(),
      createdAt: Date.now(),
    };

    // Add user message only - don't trigger bot responses
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    // Reset bot index to start from the first bot for the next round
    setNextBotIndex(0);
  };

  const generateNextResponse = async () => {
    if (isLoading || isResponding || nextBotIndex >= bots.length) return;

    const bot = bots[nextBotIndex];
    if (!bot) return;

    setIsResponding(true);
    setIsLoading(true);

    // Get the complete conversation history
    const completeHistory = messages;

    const botMessageId = generateId();
    const assistantMessage: ChatMessage = {
      id: botMessageId,
      role: "assistant",
      botId: bot.id,
      content: "",
      createdAt: Date.now(),
    };

    // Add placeholder assistant message to state
    setMessages((prev) => [...prev, assistantMessage]);

    // Generate the bot's response
    const finalContent = await streamBotReply(bot, botMessageId, completeHistory);

    // Update the message with final content
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === botMessageId
          ? {
              ...msg,
              content: finalContent,
            }
          : msg
      )
    );

    // Move to next bot
    setNextBotIndex((prev) => prev + 1);
    setIsLoading(false);
    setIsResponding(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getPreviewPayload = () => {
    const previewMessages: ChatMessage[] = [...messages];
    
    // If there's text in the input, include it as a user message in the preview
    if (input.trim()) {
      previewMessages.push({
        id: "preview-user",
        role: "user",
        content: input.trim(),
        createdAt: Date.now(),
      });
    }

      // Show preview for the next bot that will respond
      const nextBot = bots[nextBotIndex];
      if (nextBot) {
        // Build message array with same structure as streamBotReply
        const conversationContext = buildConversationContext(nextBot, bots);
        const turnInstruction = buildTurnInstruction(nextBot);
        
        // Convert preview messages to API format
        const historyMessages = previewMessages.map((msg) => {
          const speaker = getSpeakerLabel(msg);
          if (msg.role === "user") {
            return {
              role: "user" as const,
              content: `${speaker}: ${msg.content}`,
            };
          } else {
            return {
              role: "assistant" as const,
              content: `${speaker}: ${msg.content}`,
            };
          }
        });
        
        const payload: {
          model: string;
          stream: boolean;
          input: Array<{ role: string; content: string }>;
          tools?: Array<{ type: string }>;
        } = {
          model: nextBot.model,
          stream: true,
          input: [
            {
              role: "system",
              content: conversationContext,
            },
            ...historyMessages,
            {
              role: "system",
              content: turnInstruction,
            },
          ],
        };

      if (nextBot.useWebSearch) {
        payload.tools = [{ type: "web_search" }];
      }

      return payload;
    }

    return { message: "No bots configured" };
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

  // Bot management functions
  const handleCreateBot = () => {
    setEditingBot({
      id: null,
      name: "",
      personality: "",
      description: "",
      model: "gpt-4o-mini",
      useWebSearch: false,
      rules: "Provide a short, succinct and casual response.",
    });
    setShowBotManager(true);
  };

  const handleEditBot = (bot: BotConfig) => {
    setEditingBot({
      id: bot.id,
      name: bot.name,
      personality: bot.personality || "",
      description: bot.description,
      model: bot.model,
      useWebSearch: bot.useWebSearch,
      rules: bot.rules || "Provide a short, succinct and casual response.",
    });
    setShowBotManager(true);
  };

  const handleDeleteBot = (botId: string) => {
    if (confirm("Are you sure you want to delete this bot?")) {
      setBots((prev) => prev.filter((b) => b.id !== botId));
    }
  };

  const handleSaveBot = () => {
    if (!editingBot) return;

    if (!editingBot.name.trim()) {
      alert("Bot name is required");
      return;
    }

    if (editingBot.id === null) {
      // Create new bot
      const newBot: BotConfig = {
        id: generateId(),
        name: editingBot.name.trim(),
        personality: editingBot.personality.trim() || undefined,
        description: editingBot.description.trim() || "",
        model: editingBot.model,
        useWebSearch: editingBot.useWebSearch,
        rules: editingBot.rules.trim() || undefined,
        systemPrompt: `You are "${editingBot.name.trim()}" in a group conversation.

STYLE:
- Keep replies conversational and engaging.
- Respond naturally to the conversation flow.
- Be helpful and constructive.

ROLE:
- Participate actively in the group discussion.
- Provide your unique perspective based on your personality and knowledge.
- You are always speaking as "${editingBot.name.trim()}".`,
      };
      setBots((prev) => [...prev, newBot]);
    } else {
      // Update existing bot
      setBots((prev) =>
        prev.map((b) =>
          b.id === editingBot.id
            ? {
                ...b,
                name: editingBot.name.trim(),
                personality: editingBot.personality.trim() || undefined,
                description: editingBot.description.trim() || "",
                model: editingBot.model,
                useWebSearch: editingBot.useWebSearch,
                rules: editingBot.rules.trim() || undefined,
              }
            : b
        )
      );
    }

    setEditingBot(null);
    setShowBotManager(false);
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

      {/* Bot Manager Modal */}
      {showBotManager && editingBot && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => {
            setShowBotManager(false);
            setEditingBot(null);
          }}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-800">
                {editingBot.id === null ? "Create Bot" : "Edit Bot"}
              </h2>
              <button
                onClick={() => {
                  setShowBotManager(false);
                  setEditingBot(null);
                }}
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
            <div className="flex-1 overflow-auto p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editingBot.name}
                  onChange={(e) =>
                    setEditingBot({ ...editingBot, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Bot name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Personality (Optional)
                </label>
                <textarea
                  value={editingBot.personality}
                  onChange={(e) =>
                    setEditingBot({ ...editingBot, personality: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Describe the bot's perspective, knowledge, and approach..."
                  rows={3}
                />
                <p className="text-xs text-gray-500 mt-1">
                  This describes the bot's perspective and other knowledge that will be included in their system prompt.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={editingBot.description}
                  onChange={(e) =>
                    setEditingBot({ ...editingBot, description: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Brief description of the bot's role"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rules
                </label>
                <textarea
                  value={editingBot.rules}
                  onChange={(e) =>
                    setEditingBot({ ...editingBot, rules: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Provide a short, succinct and casual response."
                  rows={2}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Rules for shaping the bot's responses. These will be included in the system prompt.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Model
                </label>
                <select
                  value={editingBot.model}
                  onChange={(e) =>
                    setEditingBot({ ...editingBot, model: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4-turbo">gpt-4-turbo</option>
                  <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                </select>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="useWebSearch"
                  checked={editingBot.useWebSearch}
                  onChange={(e) =>
                    setEditingBot({ ...editingBot, useWebSearch: e.target.checked })
                  }
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="useWebSearch" className="ml-2 text-sm text-gray-700">
                  Enable Web Search
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowBotManager(false);
                  setEditingBot(null);
                }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBot}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              >
                {editingBot.id === null ? "Create" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

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
          {/* Rules Section */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Rules
            </label>
            <textarea
              value={globalRules}
              onChange={(e) => setGlobalRules(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Provide short, succinct and casual responses."
              rows={2}
            />
            <p className="text-xs text-gray-500 mt-1">
              These rules apply to all bots and will be included in their system prompts. Changes take effect immediately.
            </p>
          </div>

          {/* Bots Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Active Bots
              </label>
              <button
                onClick={handleCreateBot}
                className="px-3 py-1.5 text-sm bg-green-500 text-white rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors"
              >
                + Create Bot
              </button>
            </div>
            <div className="space-y-2">
              {bots.map((bot) => (
                <div
                  key={bot.id}
                  className="flex items-start justify-between p-3 bg-white border border-gray-200 rounded-md"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">
                        {bot.name}
                      </span>
                      {bot.useWebSearch && (
                        <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                          Web Search
                        </span>
                      )}
                    </div>
                    {bot.personality && (
                      <p className="text-xs text-gray-600 mt-1 italic">
                        Personality: {bot.personality}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">{bot.description}</p>
                    <p className="text-xs text-gray-400 mt-1">Model: {bot.model}</p>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleEditBot(bot)}
                      className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteBot(bot.id)}
                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {bots.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">
                  No bots configured. Create one to get started!
                </p>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-gray-500 mt-12">
                Start a conversation by typing a message below.
              </div>
            )}
            {messages.map((message) => {
              if (message.role === "user") {
                return (
                  <div key={message.id} className="flex justify-end mb-3">
                    <div className="max-w-[80%] rounded-lg px-4 py-2 bg-blue-500 text-white">
                      <div className="whitespace-pre-wrap break-words">
                        {message.content}
                      </div>
                    </div>
                  </div>
                );
              }

              const bot = bots.find((b) => b.id === message.botId);

              return (
                <div key={message.id} className="flex justify-start mb-3">
                  <div className="flex flex-col max-w-[80%]">
                    {bot && (
                      <span className="text-xs font-medium mb-1 px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 inline-block w-fit">
                        {bot.name}
                      </span>
                    )}
                    <div className="bg-white text-gray-800 border border-gray-200 rounded-lg px-4 py-2">
                      <div className="whitespace-pre-wrap break-words">
                        {message.content || (isLoading ? "Thinking..." : "")}
                      </div>
                    </div>
                    {message.responseTimeMs !== undefined && (
                      <div className="text-xs text-gray-400 mt-1">
                        {formatResponseTime(message.responseTimeMs)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
              disabled={isLoading || isResponding}
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
              disabled={isLoading || isResponding || !input.trim()}
              className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
          {/* Generate Next Response Button */}
          {nextBotIndex < bots.length && messages.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={generateNextResponse}
                disabled={isLoading || isResponding}
                className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                Generate next response ({bots[nextBotIndex]?.name || "Bot"})
              </button>
              <span className="text-xs text-gray-500">
                {nextBotIndex + 1} of {bots.length} bots remaining
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

