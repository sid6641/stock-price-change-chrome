import type { TriggerResult, VideoMeta } from '../types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Call 1 — Trigger: classify video as finance/non-finance and
 * extract any tickers visible in the title/description.
 */
export async function classifyVideo(
  meta: VideoMeta,
  apiKey: string,
): Promise<TriggerResult> {
  const prompt = buildTriggerPrompt(meta);
  const text = await callGemini(prompt, apiKey, 200);
  return parseTriggerResponse(text);
}

/**
 * Call 2 — Extraction: extract all stock ticker symbols from the
 * full video transcript.
 */
export async function extractTickers(
  meta: VideoMeta,
  transcript: string,
  apiKey: string,
): Promise<string[]> {
  const prompt = buildExtractionPrompt(meta, transcript);
  const text = await callGemini(prompt, apiKey, 1024);
  return parseTickerResponse(text);
}

// ─── Prompt Builders ───────────────────────────────────────────

function buildTriggerPrompt(meta: VideoMeta): string {
  return [
    'You are a financial content classifier. Analyze this YouTube video.',
    '',
    `Title: "${meta.title}"`,
    `Description: "${meta.description}"`,
    '',
    'Identify if this video discusses stock market, investing, trading, or specific companies/equities.',
    '',
    'Respond with JSON only:',
    JSON.stringify({ is_finance: false, tickers: [], reasoning: '' }),
  ].join('\n');
}

function buildExtractionPrompt(meta: VideoMeta, transcript: string): string {
  return [
    'You are a stock ticker extraction assistant. Extract ALL stock ticker symbols mentioned in this YouTube video transcript.',
    '',
    `Title: "${meta.title}"`,
    `Transcript: "${transcript}"`,
    '',
    'Rules:',
    '- Include NYSE and NASDAQ listed tickers only',
    '- Exclude non-equity tickers (crypto, ETFs, indices like SPX/NDX)',
    '- Exclude common words that happen to be tickers (IT, AI, GO, etc.) unless context clearly indicates they are stocks',
    '- No duplicates',
    '',
    'Respond with JSON only:',
    JSON.stringify({ tickers: [], total_found: 0 }),
  ].join('\n');
}

// ─── API Call ──────────────────────────────────────────────────

async function callGemini(
  prompt: string,
  apiKey: string,
  maxTokens: number,
): Promise<string> {
  const url = `${BASE_URL}/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: maxTokens,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini API error (${response.status}): ${body}`);
  }

  const data = await response.json();
  const text: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini returned empty response');
  }

  return text;
}

// ─── Response Parsers ──────────────────────────────────────────

function parseTriggerResponse(text: string): TriggerResult {
  const json = extractJson(text);
  if (!json) {
    return { isFinance: false, tickers: [] };
  }

  try {
    const parsed = JSON.parse(json);
    return {
      isFinance: Boolean(parsed.is_finance ?? parsed.isFinance ?? false),
      tickers: Array.isArray(parsed.tickers) ? parsed.tickers : [],
      reasoning: parsed.reasoning ?? '',
    };
  } catch {
    return { isFinance: false, tickers: [] };
  }
}

function parseTickerResponse(text: string): string[] {
  const json = extractJson(text);
  if (!json) return [];

  try {
    const parsed = JSON.parse(json);
    const tickers: string[] = Array.isArray(parsed.tickers) ? parsed.tickers : [];
    // Deduplicate and uppercase
    return [...new Set(tickers.map((t: string) => t.toUpperCase().trim()))];
  } catch {
    return [];
  }
}

/**
 * Extract a JSON object from Gemini's response text.
 * Handles markdown code fences (```json ... ```) and raw JSON.
 */
function extractJson(text: string): string | null {
  // Try markdown code fence first
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0].trim();

  return null;
}
