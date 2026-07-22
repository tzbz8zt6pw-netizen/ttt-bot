const assert = require('assert');
const {
  generatePayoutWeekPlanPure,
  formatPayoutAmount,
  formatPayoutRewardAmount,
  flagFromCountryCode,
  discordFlagCode,
  renderPayoutTemplate,
  renderUniformPayoutMessage,
  normalizePayoutSettings,
  localDateParts,
  DEFAULT_PAYOUT_SETTINGS,
  DEFAULT_PAYOUT_TEMPLATES,
} = require('../index');

function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function localMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test('normalizes payout settings without leaving simulation mode enabled by default', () => {
  const settings = normalizePayoutSettings({});
  assert.strictEqual(settings.mode, 'DISABLED');
  assert.strictEqual(settings.enabled, false);
  assert.strictEqual(settings.simulationEnabled, false);
  assert.strictEqual(settings.weeklyMinimum, 20);
  assert.strictEqual(settings.weeklyMaximum, 50);
});

test('generates between 20 and 50 simulated payouts by default', () => {
  const plan = generatePayoutWeekPlanPure(DEFAULT_PAYOUT_SETTINGS, {
    now: '2026-07-14T12:00:00.000Z',
    rng: seededRandom(7),
  });
  assert(plan.weeklyTarget >= 20 && plan.weeklyTarget <= 50);
  assert.strictEqual(plan.items.length, plan.weeklyTarget);
});

test('splits generated payouts across Wednesday and Thursday only', () => {
  const plan = generatePayoutWeekPlanPure(DEFAULT_PAYOUT_SETTINGS, {
    now: '2026-07-14T12:00:00.000Z',
    rng: seededRandom(10),
    weeklyTarget: 36,
  });
  const weekdays = plan.items.map(item => localDateParts(item.scheduledFor, 'Europe/London').weekday);
  assert(weekdays.every(day => day === 'WEDNESDAY' || day === 'THURSDAY'));
  assert.strictEqual(weekdays.filter(day => day === 'WEDNESDAY').length, plan.wednesdayTarget);
  assert.strictEqual(weekdays.filter(day => day === 'THURSDAY').length, plan.thursdayTarget);
  assert.strictEqual(plan.wednesdayTarget + plan.thursdayTarget, 36);
});

test('keeps scheduled times inside 10:00-22:00 Europe/London', () => {
  const plan = generatePayoutWeekPlanPure(DEFAULT_PAYOUT_SETTINGS, {
    now: '2026-07-14T12:00:00.000Z',
    rng: seededRandom(12),
    weeklyTarget: 50,
  });
  for (const item of plan.items) {
    const minutes = localMinutes(item.scheduledFor);
    assert(minutes >= 10 * 60, `${item.scheduledFor.toISOString()} before window`);
    assert(minutes <= 22 * 60, `${item.scheduledFor.toISOString()} after window`);
  }
});

test('keeps a minimum 10 minute interval per posting day where schedule capacity allows', () => {
  const plan = generatePayoutWeekPlanPure({
    ...DEFAULT_PAYOUT_SETTINGS,
    weeklyMinimum: 20,
    weeklyMaximum: 20,
  }, {
    now: '2026-07-14T12:00:00.000Z',
    rng: seededRandom(14),
    weeklyTarget: 20,
  });
  const byDay = new Map();
  for (const item of plan.items) {
    const day = localDateParts(item.scheduledFor, 'Europe/London').weekday;
    byDay.set(day, [...(byDay.get(day) || []), item.scheduledFor]);
  }
  for (const times of byDay.values()) {
    times.sort((a, b) => a.getTime() - b.getTime());
    for (let index = 1; index < times.length; index += 1) {
      const diffMinutes = (times[index].getTime() - times[index - 1].getTime()) / 60_000;
      assert(diffMinutes >= 9.9, `Expected >=10 minutes, got ${diffMinutes}`);
    }
  }
});

test('marks generated items as simulated and never live', () => {
  const plan = generatePayoutWeekPlanPure(DEFAULT_PAYOUT_SETTINGS, {
    now: '2026-07-14T12:00:00.000Z',
    rng: seededRandom(22),
    weeklyTarget: 25,
  });
  assert(plan.items.every(item => item.sourceType === 'SIMULATION'));
  assert(plan.items.every(item => item.isSimulated === true));
  assert(plan.items.every(item => /^sim_/.test(item.externalPayoutId)));
});

test('uses countries, flags and display names in each payout', () => {
  const plan = generatePayoutWeekPlanPure({
    ...DEFAULT_PAYOUT_SETTINGS,
    simulationSelectedCountries: ['GB', 'AE'],
  }, {
    now: '2026-07-14T12:00:00.000Z',
    rng: seededRandom(33),
    weeklyTarget: 20,
  });
  assert(plan.items.every(item => ['GB', 'AE'].includes(item.countryCode)));
  assert(plan.items.every(item => item.flag === flagFromCountryCode(item.countryCode)));
  assert(plan.items.every(item => item.displayName && !item.message.includes('{{')));
  assert(plan.items.every(item => /^An TTT Trader from :flag_[a-z]{2}: just secured a [£$€]?\d+\.\d{2} reward! :moneybag:$/.test(item.message)));
});

test('formats amounts and renders payout templates safely', () => {
  assert.strictEqual(formatPayoutAmount(1200, 'USD'), '$1,200');
  assert.strictEqual(formatPayoutRewardAmount(7226.208, 'USD'), '$7226.21');
  assert.strictEqual(flagFromCountryCode('GB'), '🇬🇧');
  assert.strictEqual(discordFlagCode('ES'), ':flag_es:');
  assert.strictEqual(
    renderUniformPayoutMessage({ country_code: 'ES', amount: 7226.208, currency: 'USD' }),
    'An TTT Trader from :flag_es: just secured a $7226.21 reward! :moneybag:'
  );
  assert.strictEqual(
    renderPayoutTemplate('Paid {{formatted_amount}} to {{flag}} {{display_name}}', {
      formatted_amount: '$500',
      flag: '🇬🇧',
      display_name: 'Alex T.',
    }),
    'Paid $500 to 🇬🇧 Alex T.'
  );
});

test('rotates templates without immediate repetition when possible', () => {
  const plan = generatePayoutWeekPlanPure(DEFAULT_PAYOUT_SETTINGS, {
    now: '2026-07-14T12:00:00.000Z',
    rng: seededRandom(44),
    weeklyTarget: 20,
    templates: [
      DEFAULT_PAYOUT_TEMPLATES[0],
      'Alt {{reward_amount}} {{flag_code}}',
      'Alt two {{reward_amount}} {{flag_code}}',
    ].map((bodyTemplate, index) => ({
      id: index + 1,
      name: `Template ${index + 1}`,
      bodyTemplate,
    })),
  });
  for (let index = 1; index < plan.items.length; index += 1) {
    assert.notStrictEqual(plan.items[index].templateId, plan.items[index - 1].templateId);
  }
});

console.log('Payout feed contract tests passed.');
