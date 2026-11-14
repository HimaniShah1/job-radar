import type { Job, ScoreResult } from '../types.js';
import { escapeHtml } from '../lib/text.js';

const CITY_LABEL: Record<string, string> = {
  bengaluru: 'Bengaluru',
  hyderabad: 'Hyderabad',
  pune: 'Pune',
  'remote-india': 'Remote (India)',
};

export function formatAlert(job: Job, s: ScoreResult, dashboardUrl?: string, id?: number): string {
  const cities = job.cities.map((c) => CITY_LABEL[c] ?? c).join(' · ');
  const lines = [
    `<b>${escapeHtml(job.title)}</b>`,
    `${escapeHtml(job.company)} · ${escapeHtml(cities)}`,
    `Score <b>${s.score}</b>: ${escapeHtml(s.reasons.join(', '))}`,
    `<a href="${escapeHtml(job.applyUrl ?? job.url)}">Apply</a> · <a href="${escapeHtml(job.url)}">JD</a>` +
      (dashboardUrl && id ? ` · <a href="${escapeHtml(`${dashboardUrl}/#job-${id}`)}">Track</a>` : ''),
  ];
  return lines.join('\n');
}

export async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log(`[alert, telegram not configured]\n${text}\n`);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}
