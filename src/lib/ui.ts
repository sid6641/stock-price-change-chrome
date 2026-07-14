import { logger } from './logger';
import type { TickerResult } from '../types';

const CARD_ID = 'ticker-tracker-card';
const SCAN_BTN_ID = 'tt-scan-btn';
const M = 'UI';

// ─── Colors ────────────────────────────────────────────────────

const COLORS = {
  bg: '#0f0f0f',
  cardBg: '#212121',
  text: '#f1f1f1',
  muted: '#aaaaaa',
  green: '#4caf50',
  red: '#ef5350',
  border: '#333333',
};

// ─── Render ────────────────────────────────────────────────────

export function renderResultsCard(results: TickerResult[]): void {
  logger.log(M, `Rendering card with ${results.length} tickers`);
  removeResultsCard();

  const target = findInsertionPoint();
  if (!target) {
    logger.warn(M, 'Could not find insertion point in YouTube DOM');
    return;
  }

  const card = createCard(results);
  target.insertAdjacentElement('afterbegin', card);
  logger.log(M, 'Card inserted into DOM');
}

export function removeResultsCard(): void {
  const existing = document.getElementById(CARD_ID);
  if (existing) {
    existing.remove();
    logger.log(M, 'Removed existing card from DOM');
  }
}

// ─── Card Builder ──────────────────────────────────────────────

function createCard(results: TickerResult[]): HTMLElement {
  const card = document.createElement('div');
  card.id = CARD_ID;

  Object.assign(card.style, {
    backgroundColor: COLORS.cardBg,
    color: COLORS.text,
    borderRadius: '12px',
    padding: '16px',
    margin: '16px 0',
    fontFamily: 'Roboto, Arial, sans-serif',
    fontSize: '14px',
    lineHeight: '1.5',
    border: `1px solid ${COLORS.border}`,
  });

  // Header
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    fontSize: '16px',
    fontWeight: '600' as const,
  });
  header.innerHTML = '📈 Ticker Performance';

  if (results.length > 0) {
    const dateLabel = document.createElement('span');
    dateLabel.textContent = `Since ${results[0].publishDate}`;
    Object.assign(dateLabel.style, {
      fontSize: '12px',
      color: COLORS.muted,
      fontWeight: '400' as const,
    });
    header.appendChild(dateLabel);
  }

  card.appendChild(header);

  // No results state — should rarely appear now (caller skips renderCard for empty)
  if (results.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No tickers detected in this video. Captions may be disabled or unavailable.';
    Object.assign(empty.style, {
      color: COLORS.muted,
      padding: '8px 0',
      fontSize: '13px',
    });
    card.appendChild(empty);
    return card;
  }

  // Ticker rows
  const list = document.createElement('div');
  Object.assign(list.style, {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  });

  for (const ticker of results) {
    list.appendChild(createTickerRow(ticker));
  }

  card.appendChild(list);
  return card;
}

// ─── Ticker Row ────────────────────────────────────────────────

function createTickerRow(ticker: TickerResult): HTMLElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  });

  // Left side: symbol + name
  const left = document.createElement('div');
  Object.assign(left.style, {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  });

  const symbol = document.createElement('span');
  symbol.textContent = ticker.symbol;
  Object.assign(symbol.style, {
    fontWeight: '700' as const,
    fontSize: '15px',
  });
  left.appendChild(symbol);

  const name = document.createElement('span');
  name.textContent = ticker.companyName || ticker.symbol;
  Object.assign(name.style, {
    fontSize: '12px',
    color: COLORS.muted,
  });
  left.appendChild(name);

  row.appendChild(left);

  // Right side: change percent
  const right = document.createElement('div');
  Object.assign(right.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontWeight: '600' as const,
    fontSize: '15px',
  });

  if (ticker.changePercent !== null) {
    const isUp = ticker.changePercent >= 0;
    const prefix = isUp ? '▲' : '▼';
    const color = isUp ? COLORS.green : COLORS.red;
    const label = isUp ? 'Up' : 'Down';

    const arrow = document.createElement('span');
    arrow.textContent = prefix;
    Object.assign(arrow.style, { color });

    const pct = document.createElement('span');
    pct.textContent = `${isUp ? '+' : ''}${ticker.changePercent.toFixed(1)}%`;
    Object.assign(pct.style, { color });

    const srLabel = document.createElement('span');
    srLabel.textContent = `(${label})`;
    Object.assign(srLabel.style, {
      fontSize: '12px',
      color: COLORS.muted,
      fontWeight: '400' as const,
    });

    right.appendChild(arrow);
    right.appendChild(pct);
    right.appendChild(srLabel);
  } else {
    // Error or no data
    const error = document.createElement('span');
    error.textContent = ticker.error || 'No data';
    Object.assign(error.style, {
      color: COLORS.muted,
      fontSize: '12px',
    });
    right.appendChild(error);
  }

  row.appendChild(right);
  return row;
}

// ─── Scan Button ───────────────────────────────────────────────

export function renderScanButton(onClick: () => void): void {
  removeScanButton();

  const target = findInsertionPoint();
  if (!target) {
    logger.warn(M, 'Could not find insertion point for scan button');
    return;
  }

  const btn = document.createElement('button');
  btn.id = SCAN_BTN_ID;
  btn.textContent = '🔍 Scan Tickers';
  Object.assign(btn.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 16px',
    margin: '8px 0',
    backgroundColor: '#1a73e8',
    color: '#fff',
    border: 'none',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: '600',
    fontFamily: 'Roboto, Arial, sans-serif',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  });

  btn.addEventListener('mouseenter', () => {
    btn.style.backgroundColor = '#1557b0';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.backgroundColor = '#1a73e8';
  });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    btn.textContent = '⏳ Scanning...';
    btn.disabled = true;
    btn.style.opacity = '0.6';
    onClick();
  });

  target.insertAdjacentElement('afterbegin', btn);
  logger.log(M, 'Scan button inserted into DOM');
}

export function removeScanButton(): void {
  const existing = document.getElementById(SCAN_BTN_ID);
  if (existing) {
    existing.remove();
    logger.log(M, 'Removed scan button from DOM');
  }
}

// ─── Insertion Point ───────────────────────────────────────────

/**
 * Find the YouTube #below element to insert the card under the video player.
 * Uses MutationObserver to wait if YouTube hasn't rendered it yet.
 */
function findInsertionPoint(): HTMLElement | null {
  // YouTube's #below element is the container below the video player
  const below = document.querySelector('#below');
  if (below instanceof HTMLElement) return below;

  // Fallback: try #primary (the main content column)
  const primary = document.querySelector('#primary');
  if (primary instanceof HTMLElement) return primary;

  // Fallback: try to find the comment section container
  const comments = document.querySelector('#comments');
  if (comments?.parentElement instanceof HTMLElement) return comments.parentElement;

  // Fallback: try #content (ytd-app container)
  const content = document.querySelector('#content');
  if (content instanceof HTMLElement) return content;

  // Fallback: try #page-manager
  const pageManager = document.querySelector('#page-manager');
  if (pageManager instanceof HTMLElement) return pageManager;

  // Last resort: document body
  return document.body;
}
