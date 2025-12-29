export type BotConfig = {
  id: string;
  name: string;
  role?: string; // Optional: role of the bot (e.g., "Product Designer", "Software Engineer")
  personality?: string; // Optional: describes the bot's perspective and knowledge
  description: string;
  systemPrompt: string;
  model: string;
  useWebSearch: boolean;
  rules?: string; // Optional: rules for shaping bot responses
  color?: string; // for UI badge
};

export const DEFAULT_BOTS: BotConfig[] = [
  {
    id: "bot-1",
    name: "Bot-1",
    role: "Product Designer",
    description: "",
    model: "gpt-4o-mini",
    useWebSearch: false,
    systemPrompt: `Keep your responses concise and positive. Focus on opportunities and bright sides.`,
    rules: "Provide a short, succinct and casual response.",
  },
  {
    id: "bot-2",
    name: "Bot-2",
    role: "Software Engineer",
    description: "",
    model: "gpt-4o-mini",
    useWebSearch: false,
    systemPrompt: `Keep your responses concise and analytical. Consider risks and think things through carefully.`,
    rules: "Provide a short, succinct and casual response.",
  },
  {
    id: "bot-3",
    name: "Bot-3",
    role: "Product Manager",
    description: "",
    model: "gpt-4o-mini",
    useWebSearch: false,
    systemPrompt: `Keep your responses concise and creative. Ask interesting questions and explore new ideas.`,
    rules: "Provide a short, succinct and casual response.",
  },
];

