import { describe, expect, it } from 'vitest';
import { parseYears } from '../src/lib/experience.js';
import { titleAdjustment, trainTitleModel } from '../src/lib/learn.js';
import { matchCities } from '../src/lib/location.js';
import { slugGuesses } from '../src/lib/slugs.js';
import { htmlToText, parseDate } from '../src/lib/text.js';
import { mapLimit } from '../src/lib/pool.js';

describe('matchCities', () => {
  it.each([
    [['Bengaluru, Karnataka, India'], ['bengaluru']],
    [['BLR'], ['bengaluru']],
    [['Hyderabad/Secunderabad, Telangana'], ['hyderabad']],
    [['Pune, Maharashtra'], ['pune']],
    [['Remote - India'], ['remote-india']],
    [['Pan India'], ['remote-india']],
    [['Remote (India - Bangalore ONLY)'], ['bengaluru', 'remote-india']],
    [['Remote - USA'], []],
    [['Remote'], []],
    [['Remote (work in any timezone)'], []],
    [['Chennai'], []],
    [['Noida / Bengaluru'], ['bengaluru']],
  ])('%j -> %j', (locs, expected) => {
    expect(matchCities(locs).sort()).toEqual([...expected].sort());
  });
  it('adds remote-india when the ATS flags an Indian-city role as remote', () => {
    expect(matchCities(['Bengaluru'], true).sort()).toEqual(['bengaluru', 'remote-india']);
  });
  it('treats a bare "India" location as remote-india only when the ATS says remote', () => {
    // Seen live on Lever (Level AI): location "India", workplaceType "remote".
    expect(matchCities(['India'], true)).toEqual(['remote-india']);
    expect(matchCities(['India'], false)).toEqual([]);
    expect(matchCities(['India'], null)).toEqual([]);
    expect(matchCities(['India', 'United States'], true)).toEqual([]);
  });
});

describe('parseYears', () => {
  it.each([
    ['2-4 years of experience', { min: 2, max: 4 }],
    ['1 to 3 yrs', { min: 1, max: 3 }],
    ['Minimum of 2 years backend experience', { min: 2, max: null }],
    ['3+ years', { min: 3, max: null }],
    ['4+ years overall, including 2+ years with Node', { min: 4, max: null }],
    ['We have 20+ years in business. 2-3 years needed', { min: 2, max: 3 }],
    ['No number here', null],
  ])('%s', (text, expected) => {
    expect(parseYears(text)).toEqual(expected);
  });
});

describe('text', () => {
  it('strips tags and entities', () => {
    expect(htmlToText('<p>Node&nbsp;&amp; TS</p><ul><li>a</li><li>b</li></ul>')).toBe('Node & TS\na\nb');
  });
  it('parses the date formats ATSs actually send', () => {
    expect(parseDate('2026-08-14 08:23:10 UTC')?.toISOString()).toBe('2026-08-14T08:23:10.000Z');
    expect(parseDate(1763020800000)?.getTime()).toBe(1763020800000);
    expect(parseDate('nope')).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });
});

describe('title model', () => {
  const labels = [
    ...Array.from({ length: 6 }, () => ({ title: 'SDE 2 Backend', verdict: 1 as const })),
    ...Array.from({ length: 6 }, () => ({ title: 'Software Engineer Data Platform', verdict: -1 as const })),
  ];
  it('stays neutral until there are enough labels', () => {
    expect(titleAdjustment(trainTitleModel(labels.slice(0, 5)), 'SDE 2 Backend')).toBe(0);
  });
  it('pushes liked patterns up and disliked ones down, within bounds', () => {
    const m = trainTitleModel(labels);
    const up = titleAdjustment(m, 'Backend SDE 2, Payments');
    const down = titleAdjustment(m, 'Data Platform Engineer');
    expect(up).toBeGreaterThan(0);
    expect(down).toBeLessThan(0);
    expect(Math.abs(up)).toBeLessThanOrEqual(12);
  });
});

describe('slugGuesses', () => {
  it('produces the forms boards actually use', () => {
    expect(slugGuesses('Money View')).toEqual(expect.arrayContaining(['moneyview', 'money-view']));
    expect(slugGuesses('Abnormal Security')).toContain('abnormal');
    expect(slugGuesses('Yellow.ai')).toEqual(expect.arrayContaining(['yellowai', 'yellow']));
  });
});

describe('mapLimit', () => {
  it('keeps order and caps concurrency', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2], 2, async (n) => {
      peak = Math.max(peak, ++live);
      await new Promise((r) => setTimeout(r, n));
      live--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20]);
    expect(peak).toBe(2);
  });
});
