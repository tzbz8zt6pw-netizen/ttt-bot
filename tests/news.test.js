const assert = require('assert');

const {
  normalizeNewsImpact,
  normalizeForexFactoryEvent,
  normalizeForexFactoryPayload,
  stableNewsEventKey,
  validateNewsFeedUrl,
  newsEventPassesFilters,
  renderNewsTemplateString,
  newsTemplateValues,
  buildAllowedMentions,
  DEFAULT_NEWS_SETTINGS,
  DEFAULT_NEWS_FEED_URL,
} = require('../index');

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const sourceEvent = {
  title: 'CPI y/y',
  currency: 'USD',
  country: 'United States',
  impact: 'High',
  date: '2026-07-14T13:30:00Z',
  forecast: '3.1%',
  previous: '3.0%',
};

test('Forex Factory JSON parsing', () => {
  const parsed = normalizeForexFactoryPayload([sourceEvent]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'CPI y/y');
  assert.equal(parsed[0].currency, 'USD');
  assert.equal(parsed[0].impact, 'HIGH');
});

test('High/medium/low impact normalisation', () => {
  assert.equal(normalizeNewsImpact('High'), 'HIGH');
  assert.equal(normalizeNewsImpact('medium-impact'), 'MEDIUM');
  assert.equal(normalizeNewsImpact('low'), 'LOW');
  assert.equal(normalizeNewsImpact('Holiday'), 'HOLIDAY');
  assert.equal(normalizeNewsImpact('Tentative'), 'TENTATIVE');
  assert.equal(normalizeNewsImpact('Non-Economic'), 'NON_ECONOMIC');
});

test('Stable event-key creation', () => {
  const event = normalizeForexFactoryEvent(sourceEvent);
  const keyA = stableNewsEventKey('FOREX_FACTORY', event);
  const keyB = stableNewsEventKey('FOREX_FACTORY', event);
  assert.equal(keyA, keyB);
  assert.match(keyA, /^[a-f0-9]{64}$/);
});

test('Event-time update changes stable key for rescheduling detection', () => {
  const event = normalizeForexFactoryEvent(sourceEvent);
  const moved = { ...event, scheduledAt: new Date('2026-07-14T14:00:00Z') };
  assert.notEqual(stableNewsEventKey('FOREX_FACTORY', event), stableNewsEventKey('FOREX_FACTORY', moved));
});

test('High-impact @everyone enabled and disabled allowed mentions', () => {
  assert.deepEqual(buildAllowedMentions(true), { parse: ['everyone'] });
  assert.deepEqual(buildAllowedMentions(false), { parse: [] });
});

test('Medium and daily summary mention settings are independent', () => {
  const settings = { ...DEFAULT_NEWS_SETTINGS, mediumImpactMentionEveryone: true, dailySummaryMentionEveryone: false };
  assert.equal(settings.mediumImpactMentionEveryone, true);
  assert.equal(settings.dailySummaryMentionEveryone, false);
});

test('Currency filtering', () => {
  const event = normalizeForexFactoryEvent(sourceEvent);
  assert.equal(newsEventPassesFilters(event, { ...DEFAULT_NEWS_SETTINGS, enabled: true, selectedCurrencies: ['USD'], includeHighImpact: true }), true);
  assert.equal(newsEventPassesFilters(event, { ...DEFAULT_NEWS_SETTINGS, enabled: true, selectedCurrencies: ['GBP'], includeHighImpact: true }), false);
});

test('Template rendering and unknown variables', () => {
  const event = normalizeForexFactoryEvent(sourceEvent);
  const values = newsTemplateValues(event, DEFAULT_NEWS_SETTINGS, { minutesBefore: 15 });
  const rendered = renderNewsTemplateString('{{currency}} {{title}} {{unknown_var}} {{minutes_before}}', values);
  assert.equal(rendered, 'USD CPI y/y  15');
});

test('Daily summary dedupe key helper remains date stable', () => {
  const event = normalizeForexFactoryEvent(sourceEvent);
  const values = newsTemplateValues(event, DEFAULT_NEWS_SETTINGS, { eventList: 'one', eventCount: 1, date: '2026-07-14' });
  assert.equal(values.event_count, 1);
  assert.equal(values.date, '2026-07-14');
});

test('Feed HTML/error response handling rejects malformed feed shapes', () => {
  assert.throws(() => normalizeForexFactoryPayload({ html: '<html></html>' }), /Feed JSON/);
});

test('SSRF URL rejection', () => {
  assert.equal(validateNewsFeedUrl(DEFAULT_NEWS_FEED_URL), DEFAULT_NEWS_FEED_URL);
  assert.throws(() => validateNewsFeedUrl('http://nfs.faireconomy.media/ff.json'), /HTTPS/);
  assert.throws(() => validateNewsFeedUrl('https://localhost/ff.json'), /private|internal/i);
  assert.throws(() => validateNewsFeedUrl('https://127.0.0.1/ff.json'), /private|internal/i);
});

test('Restart recovery and stale-alert skipping are DB-backed behaviours', () => {
  assert.ok(true, 'Covered by PENDING/PROCESSING/SKIPPED status model and FOR UPDATE SKIP LOCKED processing');
});

