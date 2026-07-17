const assert = require('assert');

const {
  normalizeZealySubdomain,
  normalizeZealyLeaderboard,
  detectZealyDeltaEvents,
  detectZealyMilestones,
  renderZealyTemplateString,
  zealyEventValues,
  zealyCapabilityMatrix,
  verifyZealyWebhookSecret,
  ZEALY_DEFAULT_MILESTONES,
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

test('normalizes Zealy community subdomains from plain and URL inputs', () => {
  assert.equal(normalizeZealySubdomain('TTT-Markets'), 'ttt-markets');
  assert.equal(normalizeZealySubdomain('https://zealy.io/cw/tttmarkets'), 'tttmarkets');
  assert.equal(normalizeZealySubdomain(' bad/value '), 'badvalue');
});

test('normalizes all-time leaderboard records and linked Discord identity', () => {
  const rows = normalizeZealyLeaderboard({
    items: [
      { userId: 'u1', name: 'TraderOne', discordId: '123', discordHandle: 'trader.one', xp: 4250, avatar: 'https://example.test/a.png' },
      { id: 'u2', user: { name: 'TraderTwo', discord: { id: '456', handle: 'trader.two' } }, score: 4010 },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].zealyUserId, 'u1');
  assert.equal(rows[0].discordUserId, '123');
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].discordUsername, 'trader.two');
});

test('normalizes nested Zealy leaderboard response shapes', () => {
  const rows = normalizeZealyLeaderboard({
    leaderboard: {
      items: [
        {
          user: {
            id: 'nested-1',
            name: 'Nested Trader',
            discord: { id: '999', username: 'nested_discord' },
            avatarUrl: 'https://example.com/avatar.png',
          },
          totalXp: 4200,
          position: 2,
        },
      ],
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].zealyUserId, 'nested-1');
  assert.equal(rows[0].zealyName, 'Nested Trader');
  assert.equal(rows[0].discordUserId, '999');
  assert.equal(rows[0].discordUsername, 'nested_discord');
  assert.equal(rows[0].xp, 4200);
  assert.equal(rows[0].rank, 2);
});

test('detects XP earned, rank movement and top-ten entry from snapshots', () => {
  const before = { zealy_user_id: 'u1', xp: 90, rank: 12, discord_user_id: '123' };
  const after = { zealyUserId: 'u1', zealyName: 'TraderOne', discordUserId: '123', xp: 260, rank: 8 };
  const events = detectZealyDeltaEvents(before, after, { rewardFeedMilestones: ZEALY_DEFAULT_MILESTONES, rewardFeedMilestoneMode: 'HIGHEST_ONLY' });
  assert(events.some(event => event.eventType === 'XP_EARNED' && event.xpDelta === 170));
  assert(events.some(event => event.eventType === 'MILESTONE_REACHED' && event.metadata.milestone === 250));
  assert(events.some(event => event.eventType === 'LEADERBOARD_TOP_10_ENTRY'));
});

test('detects XP deductions without inventing reward context', () => {
  const events = detectZealyDeltaEvents(
    { zealy_user_id: 'u1', xp: 500, rank: 4 },
    { zealyUserId: 'u1', xp: 350, rank: 4 },
  );
  assert.equal(events[0].eventType, 'XP_DEDUCTED');
  assert.equal(events[0].rewardName, undefined);
});

test('milestones default to highest newly crossed only', () => {
  assert.deepEqual(detectZealyMilestones(900, 1600, ZEALY_DEFAULT_MILESTONES, 'HIGHEST_ONLY'), [1500]);
  assert.deepEqual(detectZealyMilestones(900, 1600, ZEALY_DEFAULT_MILESTONES, 'ALL'), [1000, 1500]);
});

test('template rendering is safe for unknown variables and non-pinging mentions', () => {
  const values = zealyEventValues({
    discordUserId: '123',
    xpDelta: 25,
    currentXp: 1000,
    rankAfter: 5,
    occurredAt: '2026-07-16T12:00:00Z',
  });
  assert.equal(values.user_display, '<@123>');
  assert.equal(renderZealyTemplateString('{{user_display}} {{missing}} +{{xp_delta}}', values), '<@123>  +25');
});

test('capability matrix labels inferred and webhook-confirmed capabilities', () => {
  const matrix = zealyCapabilityMatrix(['QUEST_COMPLETED', 'XP_CHANGED']);
  assert.equal(matrix.find(row => row.capability === 'quest completions').source, 'WEBHOOK');
  assert.equal(matrix.find(row => row.capability === 'reward claims/redemptions').source, 'UNAVAILABLE');
});

test('webhook body secret verification uses timing-safe exact match', () => {
  assert.equal(verifyZealyWebhookSecret({ secret: 'abc123' }, 'abc123'), true);
  assert.equal(verifyZealyWebhookSecret({ secret: 'abc123' }, 'abc124'), false);
  assert.equal(verifyZealyWebhookSecret({}, 'abc123'), false);
  assert.equal(verifyZealyWebhookSecret({}, null), true);
});

console.log('Zealy contract tests passed.');
