import assert from "node:assert/strict";
import test from "node:test";

const TARGET_RTP = 0.99;
const PAYOUT_VALUES = [0, 0.01, 0.02, 0.08, 0.25, 0.55, 0.75, 0.95];
const COLD_LIKELIHOOD = [0.68, 0.18, 0.08, 0.035, 0.015, 0.006, 0.003, 0.001];
const HOT_LIKELIHOOD = [0.03, 0.04, 0.05, 0.08, 0.15, 0.23, 0.23, 0.19];
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

function payoutProbabilities(aimId, hotspotId, profile) {
  const separation = distance(points[aimId], points[hotspotId]);
  const gaussian = Math.exp(-(separation ** 2) / (2 * profile.radius ** 2));
  const heat = profile.noise + (1 - profile.noise) * gaussian ** profile.sharpness;
  return COLD_LIKELIHOOD.map(
    (coldProbability, index) =>
      (1 - heat) * coldProbability + heat * HOT_LIKELIHOOD[index],
  );
}

function expectedPayout(probabilities) {
  return probabilities.reduce(
    (total, probability, index) => total + probability * PAYOUT_VALUES[index],
    0,
  );
}

function captureReward(aimId, posterior, profile) {
  const hitProbability = posterior[aimId];
  if (hitProbability <= 0) return 0;
  const missExpectation = posterior.reduce((total, probability, hotspotId) => {
    if (hotspotId === aimId || probability === 0) return total;
    return total + probability * expectedPayout(
      payoutProbabilities(aimId, hotspotId, profile),
    );
  }, 0);
  return (TARGET_RTP - missExpectation) / hitProbability;
}

function updatePosterior(posterior, aimId, outcomeIndex, profile) {
  const weights = posterior.map((prior, hotspotId) =>
    hotspotId === aimId
      ? 0
      : prior * payoutProbabilities(aimId, hotspotId, profile)[outcomeIndex],
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

function entropy(posterior) {
  return posterior.reduce(
    (total, probability) =>
      probability > 0 ? total - probability * Math.log2(probability) : total,
    0,
  );
}

test("Gaussian payout likelihoods are normalized and spatially informative", () => {
  assert.equal(points.length, 217);
  assert.ok(PAYOUT_VALUES.every((payout) => payout >= 0 && payout < 1));
  assert.ok(Math.abs(COLD_LIKELIHOOD.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(Math.abs(HOT_LIKELIHOOD.reduce((a, b) => a + b, 0) - 1) < 1e-12);

  const profiles = [
    { radius: 0.11, noise: 0.02, sharpness: 0.85 },
    { radius: 0.145, noise: 0.05, sharpness: 1.1 },
    { radius: 0.18, noise: 0.08, sharpness: 1.35 },
  ];
  const centerId = points.find((point) => point.x === 0.5 && point.y === 0.5).id;
  const others = points
    .filter((point) => point.id !== centerId)
    .sort((a, b) => distance(points[centerId], a) - distance(points[centerId], b));

  for (const profile of profiles) {
    const near = payoutProbabilities(centerId, others[0].id, profile);
    const far = payoutProbabilities(centerId, others.at(-1).id, profile);
    assert.ok(Math.abs(near.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    assert.ok(Math.abs(far.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    assert.ok(expectedPayout(near) > expectedPayout(far) * 5);
    assert.ok(near[7] > far[7] * 5);
    assert.ok(far[0] > near[0]);
  }
});

test("each payout performs a normalized Bayesian spatial update", () => {
  const profile = { radius: 0.145, noise: 0.05, sharpness: 1.1 };
  const prior = points.map(() => 1 / points.length);
  const centerId = points.find((point) => point.x === 0.5 && point.y === 0.5).id;
  const priorMeanDistance = prior.reduce(
    (total, probability, id) => total + probability * distance(points[centerId], points[id]),
    0,
  );

  const blazePosterior = updatePosterior(prior, centerId, 7, profile);
  const blazeMeanDistance = blazePosterior.reduce(
    (total, probability, id) => total + probability * distance(points[centerId], points[id]),
    0,
  );
  assert.ok(Math.abs(blazePosterior.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.equal(blazePosterior[centerId], 0);
  assert.ok(blazeMeanDistance < priorMeanDistance);
  assert.ok(entropy(blazePosterior) < entropy(prior));

  const dustPosterior = updatePosterior(prior, centerId, 0, profile);
  const dustMeanDistance = dustPosterior.reduce(
    (total, probability, id) => total + probability * distance(points[centerId], points[id]),
    0,
  );
  assert.ok(dustMeanDistance > blazeMeanDistance);
});

test("every tested open pin has exactly 99% posterior-weighted RTP", () => {
  const profiles = [
    { radius: 0.11, noise: 0.02, sharpness: 0.85 },
    { radius: 0.145, noise: 0.05, sharpness: 1.1 },
    { radius: 0.18, noise: 0.08, sharpness: 1.35 },
  ];
  const secrets = [0, 31, 72, 108, 149, 185, 216];

  for (const profile of profiles) {
    let minimumOpeningReward = Number.POSITIVE_INFINITY;
    const openingPosterior = points.map(() => 1 / points.length);
    for (const point of points) {
      minimumOpeningReward = Math.min(
        minimumOpeningReward,
        captureReward(point.id, openingPosterior, profile),
      );
    }
    assert.ok(minimumOpeningReward > 150);

    for (const secretId of secrets) {
      let posterior = openingPosterior;
      const used = new Set();

      for (let step = 0; step < 12; step += 1) {
        const candidates = points
          .filter((point) => !used.has(point.id) && point.id !== secretId)
          .sort((a, b) => posterior[b.id] - posterior[a.id]);
        const aimId = candidates[0].id;

        for (const testedAim of candidates.slice(0, 12)) {
          const hitProbability = posterior[testedAim.id];
          if (hitProbability <= 1e-14) continue;
          const reward = captureReward(testedAim.id, posterior, profile);
          const missExpectation = posterior.reduce((total, probability, hotspotId) => {
            if (hotspotId === testedAim.id || probability === 0) return total;
            return total + probability * expectedPayout(
              payoutProbabilities(testedAim.id, hotspotId, profile),
            );
          }, 0);
          const expectedMultiplier = hitProbability * reward + missExpectation;
          assert.ok(Math.abs(expectedMultiplier - TARGET_RTP) < 1e-12);
          assert.ok(Number.isFinite(reward) && reward > 0);
        }

        const likelihoods = payoutProbabilities(aimId, secretId, profile);
        const observedOutcome = likelihoods.indexOf(Math.max(...likelihoods));
        posterior = updatePosterior(posterior, aimId, observedOutcome, profile);
        used.add(aimId);

        assert.ok(Math.abs(posterior.reduce((a, b) => a + b, 0) - 1) < 1e-12);
        assert.equal(posterior[aimId], 0);
        assert.ok(posterior[secretId] > 0);
      }
    }
  }
});
