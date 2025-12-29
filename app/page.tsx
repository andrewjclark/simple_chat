"use client";

import { useState, useRef, useEffect } from "react";
import { BotConfig, DEFAULT_BOTS } from "@/lib/bots";

type ConversationAction = 
  | { type: "response"; id: string; botId: string; content: string; createdAt: number; responseTimeMs?: number; }
  | { type: "skip"; id: string; botId: string; createdAt: number; }
  | { type: "user_message"; id: string; content: string; createdAt: number; };

// Simple ID generator
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

type BotEditState = {
  id: string | null;
  name: string;
  role: string;
  personality: string;
  description: string;
  model: string;
  useWebSearch: boolean;
  rules: string;
};

export default function Home() {
  const [bots, setBots] = useState<BotConfig[]>(DEFAULT_BOTS);
  const [actions, setActions] = useState<ConversationAction[]>([]);
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
  const [activityName, setActivityName] = useState<string>("Brainstorm");
  const [activityType, setActivityType] = useState<string>("Brainstorming Session");
  const [playerRules, setPlayerRules] = useState<string>("When generating ideas respond with a single idea and no more than a single sentence - this allows everyone a chance to contribute.");
  const [moderatorRules, setModeratorRules] = useState<string>("Once there have been a large number of ideas suggested (at least 2 per player) then choose the one you think is most interesting and ask the participants to go deeper. Once an idea has been fully explored choose another idea and pursue this.");
  const [editingActivityName, setEditingActivityName] = useState<boolean>(false);
  const [editingActivityType, setEditingActivityType] = useState<boolean>(false);
  const [editingPlayerRules, setEditingPlayerRules] = useState<boolean>(false);
  const [editingModeratorRules, setEditingModeratorRules] = useState<boolean>(false);
  const [showBotList, setShowBotList] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<string>("Moderator");
  const [editingUserRole, setEditingUserRole] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [actions]);

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

  // Helper function to build a single comprehensive system message (matching Swift pattern)
  const buildSystemMessage = (
    bot: BotConfig,
    allBots: BotConfig[]
  ): string => {
    const systemRoleStrings: string[] = [];
    
    // Build list of all bot names
    const botNames = allBots.map(b => b.name).join(", ");
    systemRoleStrings.push(`This is a multi-user conversation between ${botNames} and the ${userRole.toLowerCase()}`);
    
    // You are [name]
    let youAreText = `You are ${bot.name}`;
    if (bot.role) {
      youAreText += `, a ${bot.role}`;
    }
    systemRoleStrings.push(youAreText);
    
    // Personality
    if (bot.personality) {
      systemRoleStrings.push(`In your own words you are: ${bot.personality}`);
    }
    
    // Description
    if (bot.description) {
      systemRoleStrings.push(`You are: ${bot.description}`);
    }
    
    // Game type
    if (activityType) {
      systemRoleStrings.push(`This conversation is a ${activityType}`);
    }
    
    // Player rules
    if (playerRules) {
      systemRoleStrings.push(playerRules);
    }
    
    // Global rules (if any)
    const rulesToUse = globalRules || bot.rules || "";
    if (rulesToUse) {
      systemRoleStrings.push(rulesToUse);
    }
    
    // Join all with ". " separator
    return systemRoleStrings.join(". ");
  };

  // Helper function to get speaker label for an action
  const getSpeakerLabel = (action: ConversationAction): string => {
    if (action.type === "user_message") return userRole;
    if (action.type === "response" || action.type === "skip") {
      const bot = bots.find((b) => b.id === action.botId);
      if (bot) return bot.name;
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
    history: ConversationAction[],
  ): Promise<string> => {
    const startTime = performance.now();
    
    // Build the message array with proper role structure:
    // 1. Single system message with all context (matching Swift pattern)
    // 2. Array of conversation history messages (user and assistant)
    
    const systemMessage = buildSystemMessage(bot, bots);
    
    // Convert history to API format with proper roles
    const historyMessages = history
      .filter((action) => action.type === "user_message" || action.type === "response") // Skip skip actions
      .map((action) => {
        const speaker = getSpeakerLabel(action);
        if (action.type === "user_message") {
          return {
            role: "user" as const,
            content: `${speaker}: ${action.content}`,
          };
        } else if (action.type === "response") {
          // Only messages from the current bot should be "assistant"
          // All other bots' messages should be "user" from this bot's perspective
          const isCurrentBot = action.botId === bot.id;
          return {
            role: (isCurrentBot ? "assistant" : "user") as const,
            content: `${speaker}: ${action.content}`,
          };
        }
        return null;
      })
      .filter((msg): msg is { role: "user" | "assistant"; content: string } => msg !== null);
    
    // Build the complete message array
    const apiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content: systemMessage,
      },
      ...historyMessages,
      {
        role: "system",
        content: `${bot.name}, it is your turn now. Please respond.`,
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

        setActions((prev) =>
          prev.map((action) =>
            action.id === botMessageId && action.type === "response"
              ? { ...action, content: errorMessage, responseTimeMs }
              : action
          )
        );
        return errorMessage;
      }

      if (!response.ok || !response.body) {
        const endTime = performance.now();
        const responseTimeMs = Math.round(endTime - startTime);
        const errorMessage = await formatErrorMessage(response);
        setActions((prev) =>
          prev.map((action) =>
            action.id === botMessageId && action.type === "response"
              ? { ...action, content: errorMessage, responseTimeMs }
              : action
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

          setActions((prev) =>
            prev.map((action) =>
              action.id === botMessageId && action.type === "response"
                ? { ...action, content: cleanedContent }
                : action
            )
          );
        }

        // Calculate and store response time when stream completes
        const endTime = performance.now();
        const responseTimeMs = Math.round(endTime - startTime);
        
        // Final cleanup: strip bot name prefix from the complete response
        const finalContent = stripBotNamePrefix(accumulatedContent, bot.name);
        
        setActions((prev) =>
          prev.map((action) =>
            action.id === botMessageId && action.type === "response"
              ? { ...action, content: finalContent, responseTimeMs }
              : action
          )
        );
        
        return finalContent;
      } catch (streamError) {
        const endTime = performance.now();
        const responseTimeMs = Math.round(endTime - startTime);
        const streamErrorMessage = `❌ Stream Reading Error\n\nFailed to read the streaming response.\n\nError: ${streamError instanceof Error ? streamError.message : "Unknown stream error"}`;
        setActions((prev) =>
          prev.map((action) =>
            action.id === botMessageId && action.type === "response"
              ? { ...action, content: streamErrorMessage, responseTimeMs }
              : action
          )
        );
        return streamErrorMessage;
      }
    } catch (error) {
      const endTime = performance.now();
      const responseTimeMs = Math.round(endTime - startTime);
      console.error("Error streaming bot reply:", error);
      const errorMessage = `❌ Unexpected Error\n\nAn unexpected error occurred.\n\nError: ${error instanceof Error ? error.message : "Unknown error"}`;
      setActions((prev) =>
        prev.map((action) =>
          action.id === botMessageId && action.type === "response"
            ? { ...action, content: errorMessage, responseTimeMs }
            : action
        )
      );
      return errorMessage;
    }
  };

  const sendMessage = async () => {
    if (isLoading || isResponding) return;

    // If input is empty, skip user's turn and cycle through all remaining bots
    if (!input.trim()) {
      setIsResponding(true);
      setIsLoading(true);
      
      // Determine which bots to respond
      const startIndex = actions.length === 0 ? 0 : nextBotIndex;
      let completeHistory = [...actions];
      
      // Cycle through all remaining bots
      for (let i = startIndex; i < bots.length; i++) {
        const bot = bots[i];
        if (!bot) continue;
        
        const botMessageId = generateId();
        const responseAction: ConversationAction = {
          type: "response",
          id: botMessageId,
          botId: bot.id,
          content: "",
          createdAt: Date.now(),
        };
        
        setActions((prev) => [...prev, responseAction]);
        const botResponseContent = await streamBotReply(bot, botMessageId, completeHistory);
        
        const botResponse: ConversationAction = {
          ...responseAction,
          content: botResponseContent,
        };
        completeHistory = [...completeHistory, botResponse];
      }
      
      setIsLoading(false);
      setIsResponding(false);
      setNextBotIndex(0);
      return;
    }

    // User has entered text - add message and cycle through all bots
    const userMessage: ConversationAction = {
      type: "user_message",
      id: generateId(),
      content: input.trim(),
      createdAt: Date.now(),
    };

    setActions((prev) => [...prev, userMessage]);
    setInput("");
    
    setIsResponding(true);
    setIsLoading(true);
    
    let completeHistory: ConversationAction[] = [...actions, userMessage];
    
    // Automatically cycle through all bots
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      if (!bot) continue;
      
      const botMessageId = generateId();
      const responseAction: ConversationAction = {
        type: "response",
        id: botMessageId,
        botId: bot.id,
        content: "",
        createdAt: Date.now(),
      };
      
      setActions((prev) => [...prev, responseAction]);
      const botResponseContent = await streamBotReply(bot, botMessageId, completeHistory);
      
      const botResponse: ConversationAction = {
        ...responseAction,
        content: botResponseContent,
      };
      completeHistory = [...completeHistory, botResponse];
    }
    
    setIsLoading(false);
    setIsResponding(false);
    setNextBotIndex(0);
  };

  const generateNextResponse = async () => {
    if (isLoading || isResponding || nextBotIndex >= bots.length) return;

    const bot = bots[nextBotIndex];
    if (!bot) return;

    setIsResponding(true);
    setIsLoading(true);

    // Get the complete conversation history
    const completeHistory = actions;

    const botMessageId = generateId();
    const responseAction: ConversationAction = {
      type: "response",
      id: botMessageId,
      botId: bot.id,
      content: "",
      createdAt: Date.now(),
    };

    // Add placeholder response action to state
    setActions((prev) => [...prev, responseAction]);

    // Generate the bot's response
    const finalContent = await streamBotReply(bot, botMessageId, completeHistory);

    // Update the action with final content (already handled in streamBotReply)
    // Move to next bot
    setNextBotIndex((prev) => prev + 1);
    setIsLoading(false);
    setIsResponding(false);
  };

  const handleSkip = () => {
    if (isLoading || isResponding || nextBotIndex >= bots.length) return;

    const bot = bots[nextBotIndex];
    if (!bot) return;

    // Create skip action
    const skipAction: ConversationAction = {
      type: "skip",
      id: generateId(),
      botId: bot.id,
      createdAt: Date.now(),
    };

    // Add skip action to conversation
    setActions((prev) => [...prev, skipAction]);

    // Move to next bot
    setNextBotIndex((prev) => prev + 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getPreviewPayload = () => {
    const previewActions: ConversationAction[] = [...actions];
    
    // If there's text in the input, include it as a user message in the preview
    if (input.trim()) {
      previewActions.push({
        type: "user_message",
        id: "preview-user",
        content: input.trim(),
        createdAt: Date.now(),
      });
    }

      // Show preview for the next bot that will respond
      const nextBot = bots[nextBotIndex];
      if (nextBot) {
        // Build message array with same structure as streamBotReply
        const systemMessage = buildSystemMessage(nextBot, bots);
        
        // Convert preview actions to API format
        const historyMessages = previewActions
          .filter((action) => action.type === "user_message" || action.type === "response")
          .map((action) => {
            const speaker = getSpeakerLabel(action);
            if (action.type === "user_message") {
              return {
                role: "user" as const,
                content: `${speaker}: ${action.content}`,
              };
            } else if (action.type === "response") {
              // Only messages from the current bot should be "assistant"
              // All other bots' messages should be "user" from this bot's perspective
              const isCurrentBot = action.botId === nextBot.id;
              return {
                role: (isCurrentBot ? "assistant" : "user") as const,
                content: `${speaker}: ${action.content}`,
              };
            }
            return null;
          })
          .filter((msg): msg is { role: "user" | "assistant"; content: string } => msg !== null);
        
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
              content: systemMessage,
            },
            ...historyMessages,
            {
              role: "system",
              content: `${nextBot.name}, it is your turn now. Please respond.`,
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
      role: "",
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
      role: bot.role || "",
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
        role: editingBot.role.trim() || undefined,
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
                role: editingBot.role.trim() || undefined,
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
      {/* Header Bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-800">{activityName}</h1>
          <div className="flex items-center gap-2">
            {bots.map((bot) => (
              <div
                key={bot.id}
                className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-700"
                title={bot.role ? `${bot.name} (${bot.role})` : bot.name}
              >
                {bot.name.charAt(bot.name.length - 1)}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowBotList(true)}
            className="px-3 py-1.5 text-sm bg-green-500 text-white rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors"
          >
            Manage Bots
          </button>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>$0.00</span>
            <span>0 tokens</span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Participants */}
        <div className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Participants</h2>
            <div className="space-y-2">
              {bots.map((bot) => (
                <div
                  key={bot.id}
                  className="p-3 bg-gray-50 rounded-md border border-gray-200 hover:bg-gray-100 transition-colors cursor-pointer group relative"
                  onClick={() => handleEditBot(bot)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-700 flex-shrink-0">
                      {bot.name.charAt(bot.name.length - 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800">{bot.name}</div>
                      {bot.role && (
                        <div className="text-xs text-gray-500">{bot.role}</div>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditBot(bot);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 p-1"
                      aria-label={`Edit ${bot.name}`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </div>
                  {bot.personality && (
                    <p className="text-xs text-gray-600 mt-1 italic">{bot.personality}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Preview Prompt Button */}
      <div className="absolute top-4 left-4 z-10">
        <button
          onClick={() => setShowPreview(true)}
          className="px-4 py-2 bg-gray-700 text-white text-sm rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
        >
          Preview Prompt
        </button>
      </div>

      {/* Bot List Modal */}
      {showBotList && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowBotList(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-800">Manage Bots</h2>
              <button
                onClick={() => setShowBotList(false)}
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
                <button
                  onClick={() => {
                    handleCreateBot();
                    setShowBotList(false);
                  }}
                  className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors"
                >
                  + Create New Bot
                </button>
              </div>
              <div className="space-y-3">
                {bots.map((bot) => (
                  <div
                    key={bot.id}
                    className="flex items-start justify-between p-4 bg-gray-50 border border-gray-200 rounded-md"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-gray-800">
                          {bot.name}
                        </span>
                        {bot.role && (
                          <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">
                            {bot.role}
                          </span>
                        )}
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
                        onClick={() => {
                          handleEditBot(bot);
                          setShowBotList(false);
                        }}
                        className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteBot(bot.id)}
                        className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {bots.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-8">
                    No bots configured. Create one to get started!
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end p-4 border-t border-gray-200">
              <button
                onClick={() => setShowBotList(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
                  Role (Optional)
                </label>
                <input
                  type="text"
                  value={editingBot.role}
                  onChange={(e) =>
                    setEditingBot({ ...editingBot, role: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Product Designer, Software Engineer"
                />
                <p className="text-xs text-gray-500 mt-1">
                  The bot's role (e.g., Product Designer, Software Engineer, Product Manager).
                </p>
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
                <code className="text-gray-800">{JSON.stringify(getPreviewPayload(), null, 2)}</code>
              </pre>
              {actions.length === 0 && !input.trim() && (
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
        <div className="max-w-4xl mx-auto px-4 py-8">
          {/* Activity Section - Enhanced with card-based layout */}
          <div className="mb-4 bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="space-y-3">
              {/* Activity Name */}
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-1">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-sm font-semibold text-gray-700">
                      Name
                    </label>
                    <button
                      onClick={() => setEditingActivityName(!editingActivityName)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label="Edit activity name"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </div>
                  {editingActivityName ? (
                    <input
                      type="text"
                      value={activityName}
                      onChange={(e) => setActivityName(e.target.value)}
                      onBlur={() => setEditingActivityName(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setEditingActivityName(false);
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      autoFocus
                    />
                  ) : (
                    <div className="text-sm text-gray-800 font-medium">
                      {activityName}
                    </div>
                  )}
                </div>
              </div>

              {/* Activity Type */}
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-1">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-sm font-semibold text-gray-700">
                      Game Type
                    </label>
                    <button
                      onClick={() => setEditingActivityType(!editingActivityType)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label="Edit activity type"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </div>
                  {editingActivityType ? (
                    <input
                      type="text"
                      value={activityType}
                      onChange={(e) => setActivityType(e.target.value)}
                      onBlur={() => setEditingActivityType(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setEditingActivityType(false);
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      autoFocus
                    />
                  ) : (
                    <div className="text-sm text-gray-800 font-medium">
                      {activityType}
                    </div>
                  )}
                </div>
              </div>

              {/* Player Rules */}
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-1">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-sm font-semibold text-gray-700">
                      Player Rules
                    </label>
                    <button
                      onClick={() => setEditingPlayerRules(!editingPlayerRules)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label="Edit player rules"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </div>
                  {editingPlayerRules ? (
                    <textarea
                      value={playerRules}
                      onChange={(e) => setPlayerRules(e.target.value)}
                      onBlur={() => setEditingPlayerRules(false)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm"
                      rows={3}
                      placeholder="Enter player rules..."
                      autoFocus
                    />
                  ) : (
                    <div className="text-sm text-gray-800">
                      {playerRules || <span className="text-gray-400 italic">No player rules set</span>}
                    </div>
                  )}
                </div>
              </div>

              {/* Moderator Rules */}
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-1">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-sm font-semibold text-gray-700">
                      Moderator Rules
                    </label>
                    <button
                      onClick={() => setEditingModeratorRules(!editingModeratorRules)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label="Edit moderator rules"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </div>
                  {editingModeratorRules ? (
                    <textarea
                      value={moderatorRules}
                      onChange={(e) => setModeratorRules(e.target.value)}
                      onBlur={() => setEditingModeratorRules(false)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm"
                      rows={3}
                      placeholder="Enter moderator rules..."
                      autoFocus
                    />
                  ) : (
                    <div className="text-sm text-gray-800">
                      {moderatorRules || <span className="text-gray-400 italic">No moderator rules set</span>}
                    </div>
                  )}
                </div>
              </div>

              {/* User Role */}
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-1">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-sm font-semibold text-gray-700">
                      Your Role
                    </label>
                    <button
                      onClick={() => setEditingUserRole(!editingUserRole)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label="Edit user role"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </div>
                  {editingUserRole ? (
                    <input
                      type="text"
                      value={userRole}
                      onChange={(e) => setUserRole(e.target.value)}
                      onBlur={() => setEditingUserRole(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setEditingUserRole(false);
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      autoFocus
                      placeholder="e.g., Moderator, Leader"
                    />
                  ) : (
                    <div className="text-sm text-gray-800 font-medium">
                      {userRole}
                    </div>
                  )}
                </div>
              </div>

              {/* Rules */}
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-1">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <label className="text-sm font-semibold text-gray-700 mb-1 block">
                    Rules
                  </label>
                  <textarea
                    value={globalRules}
                    onChange={(e) => setGlobalRules(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm"
                    placeholder="Provide a short, succinct and casual response."
                    rows={2}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Conversation Actions */}
          <div className="space-y-4">
            {actions.length === 0 && (
              <div className="text-center text-gray-500 mt-12">
                Start a conversation by typing a message below.
              </div>
            )}
            {actions.map((action) => {
              if (action.type === "user_message") {
                return (
                  <div key={action.id} className="flex justify-end mb-4">
                    <div className="max-w-[75%] rounded-lg px-4 py-2.5 bg-blue-500 text-white shadow-sm">
                      <div className="whitespace-pre-wrap break-words text-sm">
                        {action.content}
                      </div>
                    </div>
                  </div>
                );
              }

              if (action.type === "skip") {
                const bot = bots.find((b) => b.id === action.botId);
                return (
                  <div key={action.id} className="flex justify-start mb-4">
                    <div className="flex flex-col max-w-[75%]">
                      {bot && (
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-gray-700">
                            {bot.name}
                          </span>
                          {bot.role && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                              {bot.role}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="bg-gray-50 text-gray-500 border border-gray-200 rounded-lg px-4 py-2.5 italic text-sm">
                        {bot?.name || "Bot"} skipped
                      </div>
                    </div>
                  </div>
                );
              }

              if (action.type === "response") {
                const bot = bots.find((b) => b.id === action.botId);

                return (
                  <div key={action.id} className="flex justify-start mb-4">
                    <div className="flex flex-col max-w-[75%]">
                      {bot && (
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-gray-700">
                            {bot.name}
                          </span>
                          {bot.role && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                              {bot.role}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="bg-white text-gray-800 border border-gray-200 rounded-lg px-4 py-2.5 shadow-sm">
                        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {action.content || (isLoading ? "Thinking..." : "")}
                        </div>
                      </div>
                      {action.responseTimeMs !== undefined && (
                        <div className="text-xs text-gray-400 mt-1.5 ml-1">
                          {formatResponseTime(action.responseTimeMs)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              return null;
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-200 bg-white">
        <div className="max-w-4xl mx-auto px-4 py-4">
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
              disabled={isLoading || isResponding}
              className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </div>
        </div>
      </div>
    </div>
  );
}

