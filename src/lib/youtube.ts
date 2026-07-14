import { logger } from './logger';
import type { VideoMeta } from '../types';

const M = 'YouTube';

/**
 * Extract video metadata from the YouTube watch page DOM.
 * Reads title, description, and publish date from page elements
 * and the embedded ytInitialPlayerResponse data.
 */
export function getVideoMeta(): VideoMeta | null {
  const url = new URL(window.location.href);
  const id = url.searchParams.get('v');
  if (!id) {
    logger.warn(M, 'No video ID in URL');
    return null;
  }

  const titleEl = document.querySelector('h1.ytd-watch-metadata');
  const title = titleEl?.textContent?.trim() ?? document.title.replace(' - YouTube', '').trim();

  const descEl = document.querySelector('#description-inline-expander') ?? document.querySelector('#description');
  const description = descEl?.textContent?.trim() ?? '';

  const publishDate = extractPublishDate();
  if (!publishDate) {
    logger.warn(M, 'Could not extract publish date for video', id);
    return null;
  }

  logger.log(M, 'Meta extracted', { id, titleLen: title.length, descLen: description.length, publishDate });
  return { id, title, description, publishDate };
}

/**
 * Extract the publish date from ytInitialPlayerResponse JSON embedded in the page.
 * Tries multiple fallback methods for robustness.
 */
function extractPublishDate(): string | null {
  // Method 1: Try ytInitialPlayerResponse from script
  const playerData = getInitialPlayerResponse();
  if (playerData) {
    const dateStr = playerData?.microformat?.playerMicroformatRenderer?.publishDate;
    if (dateStr) return dateStr.split('T')[0];
  }

  // Method 2: Try DOM metadata (dateText element in watch-metadata)
  const domDate = extractPublishDateFromDom();
  if (domDate) return domDate;

  // Method 3: Try yt-player-response script tag
  const prDate = extractPublishDateFromPlayerResponse();
  if (prDate) return prDate;

  return null;
}

/**
 * Extract publish date from the watch-metadata DOM (fallback).
 * YouTube stores the publish date in meta tags or visible elements.
 */
function extractPublishDateFromDom(): string | null {
  try {
    // Try common meta tags
    let metaTag = document.querySelector('meta[itemprop="uploadDate"]') as HTMLMetaElement | null;
    if (metaTag?.content) {
      return metaTag.content.split('T')[0];
    }

    metaTag = document.querySelector('meta[property="article:published_time"]') as HTMLMetaElement | null;
    if (metaTag?.content) {
      return metaTag.content.split('T')[0];
    }

    // Try the dateText element in watch-metadata
    const dateTextEl = document.querySelector('yt-formatted-string.date-text-content');
    if (dateTextEl?.textContent) {
      // Parse text like "Jan 15, 2026" or "15 Jan 2026"
      const text = dateTextEl.textContent.trim();
      const date = new Date(text);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract publish date from yt-player-response script tag.
 */
function extractPublishDateFromPlayerResponse(): string | null {
  try {
    const script = Array.from(document.querySelectorAll('script')).find((s) =>
      s.id === 'yt-player-response' || (s.type === 'application/json' && s.textContent?.includes('publishDate')),
    ) as HTMLScriptElement | null;

    if (!script?.textContent) return null;

    const data = JSON.parse(script.textContent);
    const dateStr = data?.microformat?.playerMicroformatRenderer?.publishDate;
    return dateStr ? dateStr.split('T')[0] : null;
  } catch {
    return null;
  }
}

/**
 * Extract the caption track URL from ytInitialPlayerResponse,
 * then fetch and parse the transcript text.
 * Returns null if no captions are available.
 */
export async function extractTranscript(): Promise<string | null> {
  const meta = getVideoMeta();
  const videoId = meta?.id;
  if (!videoId) {
    logger.warn(M, 'No video ID available for transcript extraction');
    return null;
  }

  // Try 1: YouTube's timedtext API (via caption tracks from player response)
  const timedtext = await tryTimedtextApi(videoId);
  if (timedtext) {
    logger.log(M, 'Transcript obtained via timedtext API');
    return timedtext;
  }

  // Try 2: youtubetranscript.com API (free, no auth needed)
  const ytTranscript = await tryYoutubetranscriptApi(videoId);
  if (ytTranscript) {
    logger.log(M, 'Transcript obtained via youtubetranscript.com');
    return ytTranscript;
  }

  logger.warn(M, 'All transcript sources failed for video', videoId);
  return null;
}

/**
 * Attempt transcript extraction via YouTube's timedtext API.
 * Uses the caption track URL from ytInitialPlayerResponse.
 * Tries multiple URL variants (ASR, manual, simple) for robustness.
 */
async function tryTimedtextApi(videoId: string): Promise<string | null> {
  const captionUrl = getCaptionBaseUrl();
  if (!captionUrl) {
    logger.log(M, 'No timedtext caption tracks available');
    return null;
  }

  // Build a list of URLs to try — start with the signed baseUrl, then try variants
  const urlsToTry = [captionUrl];

  // Variant 1: Strip kind=asr (the baseUrl might request ASR-only captions;
  // manual captions may need the param removed)
  if (captionUrl.includes('kind=asr')) {
    urlsToTry.push(captionUrl.replace(/&kind=asr/g, '').replace(/\?kind=asr&/, '?'));
  }

  // Variant 2: Simple URL without signing/expiration (works for some videos)
  const simpleUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`;
  if (!urlsToTry.includes(simpleUrl)) {
    urlsToTry.push(simpleUrl);
  }

  for (let attempt = 0; attempt < urlsToTry.length; attempt++) {
    const url = urlsToTry[attempt];
    logger.log(M, `Timedtext attempt ${attempt + 1}/${urlsToTry.length}:`, url);

    try {
      const response = await fetch(url);
      logger.log(M, `Timedtext response status: ${response.status}`);

      if (!response.ok) {
        logger.warn(M, `Timedtext attempt ${attempt + 1} returned HTTP ${response.status}`);
        continue;
      }

      const raw = await response.text();
      logger.log(M, `Timedtext attempt ${attempt + 1} raw response length:`, raw.length);

      if (!raw || raw.length < 20) {
        logger.warn(M, `Timedtext attempt ${attempt + 1} response too short or empty`);
        continue;
      }

      // Parse XML format
      const xmlText = parseTranscriptXml(raw);
      if (xmlText) {
        const wordCount = xmlText.split(/\s+/).length;
        logger.log(M, `Timedtext attempt ${attempt + 1} XML parsing: ${wordCount} words`);
        if (wordCount > 5) return xmlText;
      }

      // Try JSON format
      try {
        const jsonData = JSON.parse(raw);
        const texts: string[] = [];
        if (Array.isArray(jsonData)) {
          for (const item of jsonData) {
            const t = item.text || item.caption || '';
            if (t) texts.push(t);
          }
        } else if (jsonData.events) {
          for (const event of jsonData.events) {
            const segs = event.segs || [];
            for (const seg of segs) {
              if (seg.utf8) texts.push(seg.utf8);
            }
          }
        }
        const text = texts.join(' ');
        const wordCount = text.split(/\s+/).length;
        logger.log(M, `Timedtext attempt ${attempt + 1} JSON parsing: ${wordCount} words`);
        if (wordCount > 5) return text;
      } catch {
        // not JSON
      }
    } catch (err) {
      logger.error(M, `Timedtext attempt ${attempt + 1} fetch failed`, err);
    }
  }

  logger.warn(M, 'All timedtext URL variants failed for video', videoId);
  return null;
}

/**
 * Attempt transcript extraction via youtubetranscript.com API.
 * Routes through the background script to bypass CORS restrictions.
 */
async function tryYoutubetranscriptApi(videoId: string): Promise<string | null> {
  logger.log(M, 'Fetching transcript via background (youtubetranscript.com)');

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'FETCH_TRANSCRIPT',
      videoId,
    });

    if (result?.transcript) {
      const wordCount = result.transcript.split(/\s+/).length;
      logger.log(M, `Background transcript: ${wordCount} words`);
      return result.transcript;
    }

    if (result?.error) {
      logger.warn(M, 'Background transcript fetch error:', result.error);
    } else {
      logger.warn(M, 'Background returned no transcript');
    }
    return null;
  } catch (err) {
    logger.error(M, 'Failed to fetch transcript via background', err);
    return null;
  }
}

/**
 * Find the caption track URL from ytInitialPlayerResponse.
 * Prefers English captions, falls back to first available.
 */
function getCaptionBaseUrl(): string | null {
  try {
    const data = getInitialPlayerResponse();
    if (!data) return null;

    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks?.length) return null;

    const eng = tracks.find((t: any) => t.languageCode === 'en');
    return (eng ?? tracks[0]).baseUrl;
  } catch {
    return null;
  }
}

/**
 * Parse ytInitialPlayerResponse JSON from the page's embedded script tag.
 * Uses brace-counting for robustness against large JSON with nested objects.
 */
function getInitialPlayerResponse(): Record<string, any> | null {
  try {
    const script = findInitialDataScript();
    if (!script?.textContent) return null;

    const text = script.textContent;
    const startIdx = text.indexOf('ytInitialPlayerResponse');
    if (startIdx === -1) return null;

    const eqIdx = text.indexOf('=', startIdx);
    if (eqIdx === -1) return null;

    const jsonStartIdx = text.indexOf('{', eqIdx);
    if (jsonStartIdx === -1) return null;

    // Count braces to find the matching closing brace
    let braceCount = 0;
    let jsonEndIdx = -1;
    for (let i = jsonStartIdx; i < text.length; i++) {
      if (text[i] === '{') braceCount++;
      else if (text[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          jsonEndIdx = i + 1;
          break;
        }
      }
    }

    if (jsonEndIdx === -1) return null;

    const jsonStr = text.substring(jsonStartIdx, jsonEndIdx);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Parse YouTube's SRT-like transcript XML into plain text.
 * Handles both <text> elements and plain text content.
 */
function parseTranscriptXml(xml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const texts = doc.querySelectorAll('text');
  const lines: string[] = [];

  texts.forEach((el) => {
    const text = el.textContent?.trim();
    if (text) lines.push(text);
  });

  return lines.join(' ');
}

/**
 * Find the <script> tag containing ytInitialPlayerResponse.
 */
function findInitialDataScript(): HTMLScriptElement | null {
  return (
    document.querySelector('script#ytd-page-data') ??
    Array.from(document.querySelectorAll('script')).find((s) =>
      s.textContent?.includes('ytInitialPlayerResponse'),
    ) ??
    null
  );
}

/**
 * Detect SPA navigation on YouTube (yt-navigate-finish event).
 * Calls the callback when a new video page loads.
 */
export function onYouTubeNavigation(callback: () => void): () => void {
  const handler = () => {
    logger.log(M, 'SPA navigation detected — re-running trigger flow');
    callback();
  };
  document.addEventListener('yt-navigate-finish', handler);
  // Return cleanup function
  return () => document.removeEventListener('yt-navigate-finish', handler);
}
