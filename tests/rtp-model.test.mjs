import assert from "node:assert/strict";
import test from "node:test";

const TARGET_RTP = 0.99;
const radius = 6;
const spacing = 0.062;
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

function bandBetween(aId, bId) {
  const separation = distance(points[aId], points[bId]);
  if (separation <= 0.1) return "near";
  if (separation <= 0.19) return "warm";
  if (separation <= 0.31) return "cool";
  return "cold";
}

function rewardFor(aimId, possibleIds, profile) {
  const missTotal = possibleIds.reduce((total, hotspotId) => {
    if (hotspotId === aimId) return total;
    return total + profile[bandBetween(aimId, hotspotId)];
  }, 0);
  return Math.round((TARGET_RTP * possibleIds.length - missTotal) * 100) / 100;
}

test("every tested good shot has exactly 99% conditional RTP", () => {
  const profiles = [
    { cold: 0.03, cool: 0.16, warm: 0.4, near: 0.78 },
    { cold: 0.08, cool: 0.3, warm: 0.62, near: 0.94 },
    { cold: 0.06, cool: 0.23, warm: 0.51, near: 0.86 },
  ];

  assert.equal(points.length, 127);

  const stateMap = new Map();
  const remember = (possibleIds) => stateMap.set(possibleIds.join(","), possibleIds);
  const openingIds = points.map((point) => point.id);
  remember(openingIds);

  // Cover every state obtainable from every possible first arrow and heat read.
  for (const aimId of openingIds) {
    for (const observedBand of ["cold", "cool", "warm", "near"]) {
      const nextIds = openingIds.filter(
        (candidateId) =>
          candidateId !== aimId && bandBetween(aimId, candidateId) === observedBand,
      );
      if (nextIds.length) remember(nextIds);
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
      const observedBand = bandBetween(aimId, secretId);
      possibleIds = possibleIds.filter(
        (candidateId) =>
          candidateId !== aimId && bandBetween(aimId, candidateId) === observedBand,
      );
      assert.ok(possibleIds.includes(secretId));
      step += 1;
    }
    remember(possibleIds);
  }

  for (const profile of profiles) {
    assert.ok(Object.values(profile).every((multiplier) => multiplier < 1));
    assert.ok(profile.near - profile.cold >= 0.7);
    let maximumReward = 0;
    let minimumOpeningReward = Number.POSITIVE_INFINITY;

    for (const possibleIds of stateMap.values()) {
      for (const aimId of possibleIds) {
        const missTotal = possibleIds.reduce((total, hotspotId) => {
          if (hotspotId === aimId) return total;
          return total + profile[bandBetween(aimId, hotspotId)];
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
    assert.ok(minimumOpeningReward > 75);
    assert.ok(maximumReward > 100);
  }
});
