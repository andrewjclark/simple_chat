import OpenAI from "openai";

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY environment variable is missing. " +
      "Please set it in your .env.local file (for local development) or in your Vercel environment variables (for production). " +
      "You can get your API key from https://platform.openai.com/api-keys"
    );
  }
  
  if (key.trim().length === 0) {
    throw new Error(
      "OPENAI_API_KEY environment variable is set but empty. " +
      "Please set a valid API key in your .env.local file or Vercel environment variables."
    );
  }
  
  return key;
}

export const openai = new OpenAI({
  apiKey: getOpenAIKey(),
});

