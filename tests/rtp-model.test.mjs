import assert from "node:assert/strict";
import test from "node:test";

const TARGET_RTP = 0.99;
const radius = 3;
const spacing = 0.125;
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
  if (separation <= 0.145) return "near";
  if (separation <= 0.24) return "warm";
  if (separation <= 0.36) return "cool";
  return "cold";
}

function rewardFor(aimId, possibleIds, profile) {
  const missTotal = possibleIds.reduce((total, hotspotId) => {
    if (hotspotId === aimId) return total;
    return total + profile[bandBetween(aimId, hotspotId)];
  }, 0);
  return Math.round((TARGET_RTP * possibleIds.length - missTotal) * 100) / 100;
}

test("every reachable good shot has exactly 99% conditional RTP", () => {
  const profiles = [
    { cold: 0.78, cool: 0.83, warm: 0.87, near: 0.9 },
    { cold: 0.83, cool: 0.9, warm: 0.95, near: 0.99 },
    { cold: 0.8, cool: 0.86, warm: 0.91, near: 0.94 },
  ];

  assert.equal(points.length, 37);

  for (const profile of profiles) {
    assert.ok(Object.values(profile).every((multiplier) => multiplier < 1));
    const pending = [points.map((point) => point.id)];
    const seen = new Set();
    let maximumReward = 0;

    while (pending.length) {
      const possibleIds = pending.pop();
      const stateKey = possibleIds.join(",");
      if (seen.has(stateKey)) continue;
      seen.add(stateKey);

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

        for (const hotspotId of possibleIds) {
          if (hotspotId === aimId) continue;
          const observedBand = bandBetween(aimId, hotspotId);
          const nextPossibleIds = possibleIds.filter(
            (candidateId) =>
              candidateId !== aimId &&
              bandBetween(aimId, candidateId) === observedBand,
          );
          if (!seen.has(nextPossibleIds.join(","))) pending.push(nextPossibleIds);
        }
      }
    }

    assert.equal(seen.size, 2362);
    assert.ok(maximumReward > 5);
  }
});
