"use strict";

const assert = require("node:assert/strict");
const {
  LANES,
  ROUND_SIZE,
  buildSetlist,
  gradeRun,
  isValidDateString,
  resolveChallengeDate,
  scoreTap,
  seedFromString,
  shareText,
  withDateParam
} = require("../game.js");

const today = "2026-05-31";
const setlist = buildSetlist(today, ROUND_SIZE);
const repeated = buildSetlist(today, ROUND_SIZE);

assert.equal(LANES.length, 4, "four lanes are available");
assert.equal(setlist.length, ROUND_SIZE, "default round size is produced");
assert.deepEqual(setlist, repeated, "daily setlist is deterministic");

for (const pulse of setlist) {
  assert.ok(pulse.laneIndex >= 0 && pulse.laneIndex < LANES.length, "lane index stays in range");
  assert.ok(pulse.targetMs >= 820 && pulse.targetMs <= 1159, "target timing stays playable");
  assert.ok(pulse.closeMs > pulse.targetMs, "close timing follows target");
  assert.ok(pulse.targetPercent >= 60 && pulse.targetPercent <= 72, "target marker stays visible");
}

for (let index = 2; index < setlist.length; index += 1) {
  const lane = setlist[index].laneIndex;
  const previous = setlist[index - 1].laneIndex;
  const beforePrevious = setlist[index - 2].laneIndex;
  assert.ok(!(lane === previous && lane === beforePrevious), "no lane repeats more than twice");
}

assert.equal(seedFromString("same"), seedFromString("same"), "hash seed is stable");
assert.notEqual(seedFromString("same"), seedFromString("other"), "hash seed changes with input");

assert.equal(isValidDateString("2026-05-31"), true, "valid challenge date is accepted");
assert.equal(isValidDateString("2026-02-31"), false, "impossible challenge date is rejected");
assert.equal(resolveChallengeDate("?date=2026-05-31", "2026-06-04"), "2026-05-31");
assert.equal(resolveChallengeDate("?date=bad", "2026-06-04"), "2026-06-04");
assert.equal(
  withDateParam("https://example.com/rave/?foo=1#score", "2026-05-31"),
  "https://example.com/rave/?foo=1&date=2026-05-31"
);

const perfect = scoreTap(true, 20, 2);
assert.equal(perfect.kind, "perfect");
assert.equal(perfect.hit, true);
assert.equal(perfect.nextCombo, 3);
assert.ok(perfect.points > 120, "combo bonus is applied");

const nice = scoreTap(true, -130, 0);
assert.equal(nice.kind, "nice");
assert.equal(nice.hit, true);

const miss = scoreTap(true, 320, 5);
assert.equal(miss.hit, false);
assert.equal(miss.nextCombo, 0);

const wrong = scoreTap(false, 0, 5);
assert.equal(wrong.kind, "wrong lane");
assert.equal(wrong.hit, false);
assert.equal(wrong.nextCombo, 0);

assert.equal(gradeRun({ score: 2400, hits: 18, total: 18 }), "S");
assert.equal(gradeRun({ score: 300, hits: 2, total: 18 }), "D");

const share = shareText({
  date: today,
  score: 2222,
  hits: 17,
  total: 18,
  bestCombo: 11,
  grade: "A"
});
assert.ok(share.includes(today), "share text includes the daily date");
assert.ok(share.includes("2222"), "share text includes score");

console.log("core tests passed");
