import assert from "node:assert/strict";
import test from "node:test";

const TARGET_RTP = 0.99;
const MIN_HEAT_BUCKET = 16;
const DUST_PAYOUTS = [0, 0.01, 0.02];
const BURST_PAYOUTS = [0.55, 0.65, 0.75, 0.85, 0.95];
const DUST_MEAN = 0.01;
const BURST_MEAN = 0.75;
const radius = 8;
const spacing = 0.058;
const points = [];

for (let q = -radius; q <= radius; q += 1) {
  const minR = Math.max(-radius, -q - radius);
  const maxR = Math.min(radius, -q + radius);
  for (let r = minR; r <= maxR; r += 1) {
    points.push({
      id: points.length,
      x: 0.5 + spacing * (q + r / 2),
      y: 0.5 + spacing * r * (Math.sqrt(3) / 2),
    });
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function bandsForAim(aimId, possibleIds) {
  const candidates = possibleIds
    .filter((possibleId) => possibleId !== aimId)
    .sort((aId, bId) => {
      const separation = distance(points[aimId], points[aId]) - distance(points[aimId], points[bId]);
      return separation || aId - bId;
    });
  const bandCount = Math.min(
    4,
    Math.max(1, Math.floor(candidates.length / MIN_HEAT_BUCKET)),
  );
  const labels = {
    1: ["cold"],
    2: ["near", "cold"],
    3: ["near", "warm", "cold"],
    4: ["near", "warm", "cool", "cold"],
  };
  const bands = new Map();

  candidates.forEach((candidateId, index) => {
    const bucket = Math.min(
      bandCount - 1,
      Math.floor((index * bandCount) / candidates.length),
    );
    bands.set(candidateId, labels[bandCount][bucket]);
  });

  return bands;
}

function rewardFor(aimId, possibleIds, profile) {
  const bands = bandsForAim(aimId, possibleIds);
  const missTotal = possibleIds.reduce((total, hotspotId) => {
    if (hotspotId === aimId) return total;
    return total + profile[bands.get(hotspotId)];
  }, 0);
  return Math.round((TARGET_RTP * possibleIds.length - missTotal) * 100) / 100;
}

test("dust-or-burst payouts preserve their configured means", () => {
  const dustMean = DUST_PAYOUTS.reduce((total, value) => total + value, 0) / DUST_PAYOUTS.length;
  const burstMean = BURST_PAYOUTS.reduce((total, value) => total + value, 0) / BURST_PAYOUTS.length;

  assert.equal(dustMean, DUST_MEAN);
  assert.equal(burstMean, BURST_MEAN);

  for (const expectedMean of [0.02, 0.04, 0.12, 0.18, 0.32, 0.45, 0.6, 0.75]) {
    const burstChance = (expectedMean - DUST_MEAN) / (BURST_MEAN - DUST_MEAN);
    const reconstructedMean = (1 - burstChance) * DUST_MEAN + burstChance * BURST_MEAN;
    assert.ok(Math.abs(reconstructedMean - expectedMean) < 1e-12);
    assert.ok(burstChance >= 0 && burstChance <= 1);
  }

  const burstChance = (expectedMean) => (expectedMean - DUST_MEAN) / (BURST_MEAN - DUST_MEAN);
  assert.ok(burstChance(0.04) < 0.05);
  assert.ok(burstChance(0.18) > 0.2);
  assert.ok(burstChance(0.45) > 0.59);
  assert.ok(burstChance(0.6) > 0.79);
  assert.equal(burstChance(0.75), 1);
});

test("every tested good shot has exactly 99% conditional RTP", () => {
  const profiles = [
    { cold: 0.02, cool: 0.12, warm: 0.32, near: 0.6 },
    { cold: 0.04, cool: 0.18, warm: 0.45, near: 0.75 },
    { cold: 0.03, cool: 0.15, warm: 0.39, near: 0.68 },
  ];

  assert.equal(points.length, 217);

  const stateMap = new Map();
  const remember = (possibleIds) => stateMap.set(possibleIds.join(","), possibleIds);
  const openingIds = points.map((point) => point.id);
  remember(openingIds);

  // Cover every state obtainable from every possible first arrow and heat read.
  for (const aimId of openingIds) {
    const bands = bandsForAim(aimId, openingIds);
    for (const observedBand of ["cold", "cool", "warm", "near"]) {
      const nextIds = openingIds.filter(
        (candidateId) =>
          candidateId !== aimId && bands.get(candidateId) === observedBand,
      );
      if (nextIds.length) {
        assert.equal(nextIds.length, 54);
        remember(nextIds);
      }
    }
  }

  // Add complete, deterministic hunts for every possible secret hotspot.
  for (const secretId of openingIds) {
    let possibleIds = openingIds;
    let step = 0;
    while (possibleIds.length > 1) {
      remember(possibleIds);
      const aimId = possibleIds[(secretId * 17 + step * 13) % possibleIds.length];
      if (aimId === secretId) break;
      const bands = bandsForAim(aimId, possibleIds);
      const observedBand = bands.get(secretId);
      possibleIds = possibleIds.filter(
        (candidateId) =>
          candidateId !== aimId && bands.get(candidateId) === observedBand,
      );
      assert.ok(possibleIds.includes(secretId));
      step += 1;
    }
    remember(possibleIds);
  }

  for (const profile of profiles) {
    assert.ok(Object.values(profile).every((multiplier) => multiplier < 1));
    assert.ok(profile.near - profile.cold >= 0.56);
    let maximumReward = 0;
    let minimumOpeningReward = Number.POSITIVE_INFINITY;

    for (const possibleIds of stateMap.values()) {
      for (const aimId of possibleIds) {
        const bands = bandsForAim(aimId, possibleIds);
        const missTotal = possibleIds.reduce((total, hotspotId) => {
          if (hotspotId === aimId) return total;
          return total + profile[bands.get(hotspotId)];
        }, 0);
        const reward = rewardFor(aimId, possibleIds, profile);
        const expectedMultiplier = (reward + missTotal) / possibleIds.length;
        maximumReward = Math.max(maximumReward, reward);

        assert.ok(Math.abs(expectedMultiplier - TARGET_RTP) < 1e-12);
        assert.ok(reward >= TARGET_RTP);
        if (possibleIds.length === points.length) {
          minimumOpeningReward = Math.min(minimumOpeningReward, reward);
        }
      }
    }

    assert.ok(stateMap.size > 400);
    assert.ok(minimumOpeningReward > 138);
    assert.ok(maximumReward > 138);
  }
});
