import { logger } from './logger';
import type { TriggerResult, VideoMeta } from '../types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const M = 'Gemini';

/**
 * Call 1 — Trigger: classify video as finance/non-finance and
 * extract any tickers visible in the title/description.
 */
export async function classifyVideo(
  meta: VideoMeta,
  apiKey: string,
): Promise<TriggerResult> {
  logger.log(M, 'Stage 1 — classifying video', { title: meta.title.slice(0, 60) });
  const prompt = buildTriggerPrompt(meta);
  const text = await callGemini(prompt, apiKey, 8192);
  const result = parseTriggerResponse(text);
  logger.log(M, 'Stage 1 result', {
    isFinance: result.isFinance,
    tickers: result.tickers,
    reasoning: result.reasoning?.slice(0, 80),
  });
  return result;
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
  const wordCount = transcript.split(/\s+/).length;
  logger.log(M, `Stage 2 — extracting tickers from transcript (${wordCount} words)`);
  const prompt = buildExtractionPrompt(meta, transcript);
  const text = await callGemini(prompt, apiKey, 8192);
  const tickers = parseTickerResponse(text);
  logger.log(M, `Stage 2 result: ${tickers.length} tickers`, tickers);
  return tickers;
}

/**
 * Call 2b — Fallback: extract stock ticker symbols from the video
 * description when no transcript is available. The description may
 * contain timestamps, chapter markers, or explicit ticker mentions.
 */
export async function extractTickersFromDescription(
  meta: VideoMeta,
  apiKey: string,
): Promise<string[]> {
  logger.log(M, 'Stage 2b — extracting tickers from description (no transcript)');
  const prompt = buildDescriptionTickerPrompt(meta);
  const text = await callGemini(prompt, apiKey, 8192);
  const tickers = parseTickerResponse(text);
  logger.log(M, `Stage 2b result: ${tickers.length} tickers`, tickers);
  return tickers;
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
    'Return ONLY valid JSON — no markdown, no code fences, no other text:',
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
    'Return ONLY valid JSON — no markdown, no code fences, no other text:',
    JSON.stringify({ tickers: [], total_found: 0 }),
  ].join('\n');
}

function buildDescriptionTickerPrompt(meta: VideoMeta): string {
  return [
    'You are a stock ticker extraction assistant. This YouTube video has no captions/transcript available.',
    'Extract any stock ticker symbols you can identify from the video title and description below.',
    '',
    `Title: "${meta.title}"`,
    `Description: "${meta.description}"`,
    '',
    'Rules:',
    '- Look for explicit ticker symbols (AAPL, MSFT, TSLA, etc.) or well-known company names that have clear ticker mappings',
    '- Include NYSE and NASDAQ listed tickers only',
    '- Exclude non-equity tickers (crypto, ETFs, indices like SPX/NDX)',
    '- Exclude common words that happen to be tickers (IT, AI, GO, etc.) unless context clearly indicates they are stocks',
    '- If the title mentions a specific number of stocks (e.g., "Top 10 Stocks") but no tickers are named, return empty array',
    '- No duplicates',
    '- Be conservative: only return tickers you are highly confident about',
    '',
    'Return ONLY valid JSON — no markdown, no code fences, no other text:',
    JSON.stringify({ tickers: [], total_found: 0 }),
  ].join('\n');
}

// ─── API Call ──────────────────────────────────────────────────

async function callGemini(
  prompt: string,
  apiKey: string,
  maxTokens: number,
): Promise<string> {
  logger.log(M, 'Sending request to Gemini API', { maxTokens });
  const url = `${BASE_URL}/gemini-3.5-flash:generateContent?key=${apiKey}`;

  const start = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: maxTokens,
        stopSequences: ['\n}'],
      },
    }),
  });
  const elapsed = Math.round(performance.now() - start);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error(M, `API error (${response.status}) after ${elapsed}ms`, body.slice(0, 200));
    throw new Error(`Gemini API error (${response.status}): ${body}`);
  }

  const body = await response.text();
  logger.log(M, `API raw response (${elapsed}ms): ${body.slice(0, 300)}`);
  
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    logger.error(M, 'Failed to parse JSON response', body);
    throw new Error(`Failed to parse Gemini response: ${e}`);
  }
  
  const text: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    logger.error(M, `API returned no text after ${elapsed}ms`, { fullData: JSON.stringify(data).slice(0, 300) });
    throw new Error('Gemini returned empty response');
  }

  logger.log(M, `API responded in ${elapsed}ms`, { responseLen: text.length });
  return text;
}

// ─── Response Parsers ──────────────────────────────────────────

function parseTriggerResponse(text: string): TriggerResult {
  const json = extractJson(text);
  if (!json) {
    logger.warn(M, 'Could not extract JSON from trigger response');
    return { isFinance: false, tickers: [] };
  }

  try {
    const parsed = JSON.parse(json);
    const result = {
      isFinance: Boolean(parsed.is_finance ?? parsed.isFinance ?? false),
      tickers: Array.isArray(parsed.tickers) ? parsed.tickers : [],
      reasoning: parsed.reasoning ?? '',
    };
    logger.log(M, 'Parsed trigger response', result);
    return result;
  } catch (err) {
    logger.error(M, 'Failed to parse trigger JSON', err);
    return { isFinance: false, tickers: [] };
  }
}

function parseTickerResponse(text: string): string[] {
  const json = extractJson(text);
  if (!json) {
    logger.warn(M, 'Could not extract JSON from extraction response');
    return [];
  }

  try {
    const parsed = JSON.parse(json);
    const tickers: string[] = Array.isArray(parsed.tickers) ? parsed.tickers : [];
    const deduped = [...new Set(tickers.map((t: string) => t.toUpperCase().trim()))];
    logger.log(M, `Parsed ${deduped.length} unique tickers`, deduped);
    return deduped;
  } catch (err) {
    logger.error(M, 'Failed to parse ticker JSON', err);
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
  if (fenceMatch) {
    logger.log(M, 'Extracted JSON from markdown fence');
    return fenceMatch[1].trim();
  }

  // Try raw JSON object — find first '{' and grab everything from there
  const startIdx = text.indexOf('{');
  if (startIdx !== -1) {
    const candidate = text.slice(startIdx).trim();
    // Check if JSON is complete (has matching braces)
    let depth = 0;
    let closed = false;
    for (const ch of candidate) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) closed = true;
      }
    }
    if (closed) {
      logger.log(M, 'Extracted complete JSON from response');
      return candidate;
    }
    // Incomplete JSON — try appending closing braces and parse
    const padded = candidate + '}'.repeat(depth);
    try {
      JSON.parse(padded);
      logger.log(M, 'Extracted recovered JSON (appended closing braces)');
      return padded;
    } catch {
      logger.warn(M, 'Could not recover truncated JSON', candidate.slice(0, 80));
    }
  }

  logger.warn(M, 'No JSON found in response', text.slice(0, 100));
  return null;
}
