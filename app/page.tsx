"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

const STORAGE_KEY = "hotspot-archery-state-v8";
const LEGACY_STORAGE_KEYS = [
  "fourtune-vaults-state-v1",
  "hotspot-archery-state-v1",
  "hotspot-archery-state-v2",
  "hotspot-archery-state-v3",
  "hotspot-archery-state-v4",
  "hotspot-archery-state-v5",
  "hotspot-archery-state-v6",
  "hotspot-archery-state-v7",
];
const ARROW_STAKE = 10;
const INITIAL_BALANCE = 500;
const TARGET_RTP = 0.99;
const TARGET_RADIUS = 0.495;
const PAYOUT_VALUES = [0, 0.01, 0.02, 0.08, 0.25, 0.55, 0.75, 0.95] as const;
const COLD_LIKELIHOOD = [0.68, 0.18, 0.08, 0.035, 0.015, 0.006, 0.003, 0.001] as const;
const HOT_LIKELIHOOD = [0.03, 0.04, 0.05, 0.08, 0.15, 0.23, 0.23, 0.19] as const;

type Point = { x: number; y: number };
type SearchPoint = Point & { id: number };
type SignalResult = "dust" | "spark" | "surge" | "blaze";

type SignalProfile = {
  radius: number;
  noise: number;
  sharpness: number;
};

type Hotspot = {
  pointId: number;
  profile: SignalProfile;
};

type Shot = SearchPoint & {
  key: number;
  number: number;
  multiplier: number;
  returned: number;
  net: number;
  distance: number;
  result: SignalResult | "hit";
  outcomeIndex: number | null;
  hitChance: number;
  entropyBefore: number;
  entropyAfter: number;
  rewardOnAim: number;
};

type Round = {
  id: number;
  hotspot: Hotspot;
  posterior: number[];
  shots: Shot[];
  finished: boolean;
};

type GameState = {
  version: 8;
  balance: number;
  round: Round;
  sound: boolean;
  stats: {
    rounds: number;
    arrows: number;
    wagered: number;
    returned: number;
    bestMultiplier: number;
    bestFind: number | null;
    refills: number;
  };
};

function buildSearchPoints() {
  const points: SearchPoint[] = [];
  const radius = 8;
  const spacing = 0.058;

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

  return points;
}

const SEARCH_POINTS = buildSearchPoints();
const ALL_POINT_IDS = SEARCH_POINTS.map((point) => point.id);

function randomUnit() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] / 4294967296;
  }
  return Math.random();
}

function randomBetween(min: number, max: number) {
  return min + randomUnit() * (max - min);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function createSignalProfile(): SignalProfile {
  return {
    radius: round3(randomBetween(0.11, 0.18)),
    noise: round3(randomBetween(0.02, 0.08)),
    sharpness: round2(randomBetween(0.85, 1.35)),
  };
}

function pointById(id: number) {
  return SEARCH_POINTS[id];
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nearestSearchPoint(point: Point) {
  return SEARCH_POINTS.reduce((nearest, candidate) =>
    distance(point, candidate) < distance(point, nearest) ? candidate : nearest,
  );
}

function payoutProbabilities(
  aimedPointId: number,
  hotspotPointId: number,
  profile: SignalProfile,
) {
  const separation = distance(pointById(aimedPointId), pointById(hotspotPointId));
  const gaussian = Math.exp(-(separation ** 2) / (2 * profile.radius ** 2));
  const heat = profile.noise + (1 - profile.noise) * gaussian ** profile.sharpness;
  return COLD_LIKELIHOOD.map(
    (coldProbability, index) =>
      (1 - heat) * coldProbability + heat * HOT_LIKELIHOOD[index],
  );
}

function expectedPayout(probabilities: number[]) {
  return probabilities.reduce(
    (total, probability, index) => total + probability * PAYOUT_VALUES[index],
    0,
  );
}

function sampleOutcome(probabilities: number[]) {
  const roll = randomUnit();
  let cumulative = 0;
  for (let index = 0; index < probabilities.length; index += 1) {
    cumulative += probabilities[index];
    if (roll <= cumulative) return index;
  }
  return probabilities.length - 1;
}

function posteriorEntropy(posterior: number[]) {
  return posterior.reduce(
    (total, probability) =>
      probability > 0 ? total - probability * Math.log2(probability) : total,
    0,
  );
}

function updatePosterior(
  posterior: number[],
  aimedPointId: number,
  outcomeIndex: number,
  profile: SignalProfile,
) {
  const weights = posterior.map((prior, hotspotPointId) =>
    hotspotPointId === aimedPointId
      ? 0
      : prior * payoutProbabilities(aimedPointId, hotspotPointId, profile)[outcomeIndex],
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

function expectedInformationGain(
  posterior: number[],
  aimedPointId: number,
  profile: SignalProfile,
) {
  const entropyBefore = posteriorEntropy(posterior);
  let expectedEntropyAfter = 0;

  PAYOUT_VALUES.forEach((_, outcomeIndex) => {
    const outcomeMass = posterior.reduce((total, probability, hotspotPointId) => {
      if (hotspotPointId === aimedPointId || probability === 0) return total;
      return total + probability * payoutProbabilities(
        aimedPointId,
        hotspotPointId,
        profile,
      )[outcomeIndex];
    }, 0);
    if (outcomeMass > 0) {
      expectedEntropyAfter += outcomeMass * posteriorEntropy(
        updatePosterior(posterior, aimedPointId, outcomeIndex, profile),
      );
    }
  });

  return entropyBefore - expectedEntropyAfter;
}

function captureReward(
  aimedPointId: number,
  posterior: number[],
  profile: SignalProfile,
) {
  const hitProbability = posterior[aimedPointId];
  if (hitProbability <= 0) return 0;
  const missExpectation = posterior.reduce((total, probability, hotspotPointId) => {
    if (hotspotPointId === aimedPointId || probability === 0) return total;
    return total + probability * expectedPayout(
      payoutProbabilities(aimedPointId, hotspotPointId, profile),
    );
  }, 0);
  return (TARGET_RTP - missExpectation) / hitProbability;
}

function signalResult(outcomeIndex: number): SignalResult {
  if (outcomeIndex <= 2) return "dust";
  if (outcomeIndex <= 4) return "spark";
  if (outcomeIndex <= 6) return "surge";
  return "blaze";
}

function missDistributionStats(
  aimedPointId: number,
  posterior: number[],
  profile: SignalProfile,
) {
  const missMass = 1 - posterior[aimedPointId];
  let firstMoment = 0;
  let secondMoment = 0;
  posterior.forEach((probability, hotspotPointId) => {
    if (hotspotPointId === aimedPointId || probability === 0) return;
    const likelihoods = payoutProbabilities(aimedPointId, hotspotPointId, profile);
    likelihoods.forEach((likelihood, index) => {
      const weighted = probability * likelihood;
      firstMoment += weighted * PAYOUT_VALUES[index];
      secondMoment += weighted * PAYOUT_VALUES[index] ** 2;
    });
  });
  const mean = missMass > 0 ? firstMoment / missMass : 0;
  return {
    mean,
    variance: missMass > 0 ? secondMoment / missMass - mean ** 2 : 0,
  };
}

function createRound(id: number): Round {
  return {
    id,
    hotspot: {
      pointId: Math.floor(randomUnit() * SEARCH_POINTS.length),
      profile: createSignalProfile(),
    },
    posterior: ALL_POINT_IDS.map(() => 1 / SEARCH_POINTS.length),
    shots: [],
    finished: false,
  };
}

function createGame(): GameState {
  return {
    version: 8,
    balance: INITIAL_BALANCE,
    round: createRound(1),
    sound: true,
    stats: {
      rounds: 0,
      arrows: 0,
      wagered: 0,
      returned: 0,
      bestMultiplier: 0,
      bestFind: null,
      refills: 0,
    },
  };
}

function formatCredits(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function resultLabel(result: Shot["result"]) {
  if (result === "hit") return "HOTSPOT";
  return result.toUpperCase();
}

function rewardQuality(multiplier: number) {
  if (multiplier >= 190) return "LEGENDARY";
  if (multiplier >= 150) return "MASSIVE";
  if (multiplier >= 100) return "RICH";
  return "VOLATILE";
}

function varianceLabel(variance: number) {
  if (variance >= 0.04) return "EXTREME";
  if (variance >= 0.02) return "WILD";
  if (variance >= 0.01) return "HIGH";
  return "LOW";
}

function playTone(enabled: boolean, result: Shot["result"], multiplier: number) {
  if (!enabled || typeof window === "undefined" || !window.AudioContext) return;
  const context = new window.AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const frequencies: Record<Shot["result"], number> = {
    dust: 150,
    spark: 240,
    surge: 390,
    blaze: 560,
    hit: 720 + Math.min(multiplier, 8) * 35,
  };
  oscillator.frequency.setValueAtTime(frequencies[result], context.currentTime);
  oscillator.type = result === "hit" ? "triangle" : "sine";
  gain.gain.setValueAtTime(0.05, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    context.currentTime + (result === "hit" ? 0.65 : 0.18),
  );
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + (result === "hit" ? 0.65 : 0.18));
  oscillator.addEventListener("ended", () => void context.close());
}

export default function Home() {
  const [game, setGame] = useState<GameState | null>(null);
  const [aim, setAim] = useState<Point>({ x: 0.5, y: 0.5 });
  const [notice, setNotice] = useState(
    "Pick a search pin. Far misses pay dust; rising payouts signal you are closing in.",
  );
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      try {
        LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as GameState;
          if (parsed.version === 8 && parsed.round?.hotspot && parsed.round?.posterior) {
            setGame(parsed);
            setNotice(
              parsed.round.finished
                ? `Hotspot captured in ${parsed.round.shots.length} arrows.`
                : `Bayesian field loaded with ${posteriorEntropy(parsed.round.posterior).toFixed(2)} bits of uncertainty.`,
            );
            return;
          }
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
      setGame(createGame());
    }, 0);

    return () => window.clearTimeout(hydrationTimer);
  }, []);

  useEffect(() => {
    if (game) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  }, [game]);

  const bestClue = useMemo(() => {
    const misses = game?.round.shots.filter((shot) => shot.result !== "hit") ?? [];
    if (!misses.length) return null;
    return misses.reduce((best, shot) =>
      shot.multiplier > best.multiplier ? shot : best,
    );
  }, [game]);

  if (!game) {
    return (
      <main className="loading-screen">
        <div className="loading-target"><span /></div>
        <p>STRINGING THE RANGE…</p>
      </main>
    );
  }

  const { round } = game;
  const hotspotPoint = pointById(round.hotspot.pointId);
  const aimPoint = nearestSearchPoint(aim);
  const openingPosterior = ALL_POINT_IDS.map(() => 1 / SEARCH_POINTS.length);
  const openingReward = captureReward(
    round.hotspot.pointId,
    openingPosterior,
    round.hotspot.profile,
  );
  const capturedShot = round.shots.find((shot) => shot.result === "hit") ?? null;
  const usedPointIds = new Set(round.shots.map((shot) => shot.id));
  const openPoints = SEARCH_POINTS.filter((point) => !usedPointIds.has(point.id));
  const openSlotCount = openPoints.length;
  const currentEntropy = posteriorEntropy(round.posterior);
  const openingEntropy = Math.log2(SEARCH_POINTS.length);
  const informationGain = openingEntropy - currentEntropy;
  const fieldConfidence = Math.min(1, informationGain / 2.5);
  const topProbability = Math.max(...round.posterior);
  const aimProbability = round.posterior[aimPoint.id];
  const aimedReward = usedPointIds.has(aimPoint.id)
    ? 0
    : captureReward(aimPoint.id, round.posterior, round.hotspot.profile);
  const aimedInformation = usedPointIds.has(aimPoint.id)
    ? 0
    : expectedInformationGain(round.posterior, aimPoint.id, round.hotspot.profile);
  const roundNet = round.shots.reduce((sum, shot) => sum + shot.net, 0);
  const roundReturned = round.shots.reduce((sum, shot) => sum + shot.returned, 0);
  const realizedRtp = round.shots.length
    ? roundReturned / (round.shots.length * ARROW_STAKE)
    : 0;
  const lifetimeNet = game.stats.returned - game.stats.wagered;
  const openingMissStats = missDistributionStats(
    round.hotspot.pointId,
    openingPosterior,
    round.hotspot.profile,
  );
  const bestOpenPoint = openPoints.reduce<SearchPoint | null>((best, point) => {
    if (!best || round.posterior[point.id] > round.posterior[best.id]) return point;
    return best;
  }, null);

  function aimBestOpenPoint() {
    if (!bestOpenPoint || round.finished) return;
    setAim({ x: bestOpenPoint.x, y: bestOpenPoint.y });
    setNotice(
      `Highest-probability open pin selected: ${(round.posterior[bestOpenPoint.id] * 100).toFixed(2)}%. Click the target or press Enter to fire.`,
    );
  }

  function shoot(point: Point) {
    if (!game || game.round.finished) return;
    if (distance(point, { x: 0.5, y: 0.5 }) > TARGET_RADIUS) {
      setNotice("That aim sits outside the target. Pull it inside the outer ring.");
      return;
    }

    const selected = nearestSearchPoint(point);
    if (usedPointIds.has(selected.id)) {
      setNotice("That slot already holds an arrow. Choose an open pin—no credits were charged.");
      return;
    }
    const autoRefilled = game.balance < ARROW_STAKE;
    const fundedBalance = autoRefilled
      ? round2(game.balance + INITIAL_BALANCE)
      : game.balance;
    const isHit = selected.id === round.hotspot.pointId;
    const rewardOnAim = captureReward(
      selected.id,
      round.posterior,
      round.hotspot.profile,
    );
    const entropyBefore = posteriorEntropy(round.posterior);
    let result: Shot["result"];
    let multiplier: number;
    let outcomeIndex: number | null = null;
    let nextPosterior = round.posterior;

    if (isHit) {
      result = "hit";
      multiplier = rewardOnAim;
      nextPosterior = round.posterior.map((_, pointId) =>
        pointId === round.hotspot.pointId ? 1 : 0,
      );
    } else {
      const likelihoods = payoutProbabilities(
        selected.id,
        round.hotspot.pointId,
        round.hotspot.profile,
      );
      outcomeIndex = sampleOutcome(likelihoods);
      multiplier = PAYOUT_VALUES[outcomeIndex];
      result = signalResult(outcomeIndex);
      nextPosterior = updatePosterior(
        round.posterior,
        selected.id,
        outcomeIndex,
        round.hotspot.profile,
      );
    }

    const returned = round2(ARROW_STAKE * multiplier);
    const net = round2(returned - ARROW_STAKE);
    const entropyAfter = posteriorEntropy(nextPosterior);
    const shotNumber = round.shots.length + 1;
    const shot: Shot = {
      ...selected,
      key: round.id * 10000 + shotNumber,
      number: shotNumber,
      multiplier,
      returned,
      net,
      distance: distance(selected, hotspotPoint),
      result,
      outcomeIndex,
      hitChance: round.posterior[selected.id],
      entropyBefore,
      entropyAfter,
      rewardOnAim,
    };

    setGame({
      ...game,
      balance: round2(fundedBalance + net),
      round: {
        ...round,
        posterior: nextPosterior,
        shots: [...round.shots, shot],
        finished: isHit,
      },
      stats: {
        ...game.stats,
        rounds: game.stats.rounds + (isHit ? 1 : 0),
        arrows: game.stats.arrows + 1,
        wagered: game.stats.wagered + ARROW_STAKE,
        returned: round2(game.stats.returned + returned),
        bestMultiplier: Math.max(game.stats.bestMultiplier, multiplier),
        bestFind: isHit
          ? game.stats.bestFind === null
            ? shotNumber
            : Math.min(game.stats.bestFind, shotNumber)
          : game.stats.bestFind,
        refills: game.stats.refills + (autoRefilled ? 1 : 0),
      },
    });

    playTone(game.sound, result, multiplier);
    const refillMessage = autoRefilled ? `AUTO +${INITIAL_BALANCE} DEMO CREDITS · ` : "";
    if (isHit) {
      setNotice(`${refillMessage}Bullseye found in ${shotNumber} arrows — ${multiplier.toFixed(2)}× captured.`);
    } else {
      const nextLeader = Math.max(...nextPosterior);
      setNotice(
        `${refillMessage}${multiplier.toFixed(2)}× ${result} signal — entropy ${entropyBefore.toFixed(2)} → ${entropyAfter.toFixed(2)} bits; leader ${(nextLeader * 100).toFixed(1)}%.`,
      );
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    setAim({
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    });
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
    setAim(point);
    shoot(point);
  }

  function handleTargetKey(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 0.01 : 0.035;
    let next = aim;
    if (event.key === "ArrowLeft") next = { ...aim, x: Math.max(0.02, aim.x - step) };
    else if (event.key === "ArrowRight") next = { ...aim, x: Math.min(0.98, aim.x + step) };
    else if (event.key === "ArrowUp") next = { ...aim, y: Math.max(0.02, aim.y - step) };
    else if (event.key === "ArrowDown") next = { ...aim, y: Math.min(0.98, aim.y + step) };
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      shoot(aimPoint);
      return;
    } else return;
    event.preventDefault();
    setAim(next);
  }

  function startNextRound() {
    setGame({ ...game, round: createRound(round.id + 1) });
    setAim({ x: 0.5, y: 0.5 });
    setNotice("Fresh target. The hotspot and randomized Gaussian signal field have both moved.");
  }

  function resetRound() {
    if (
      !round.finished &&
      round.shots.length > 0 &&
      !window.confirm("Abandon this hunt and clear every arrow? Your balance will be restored to at least 500 demo credits.")
    ) return;
    const restoredBalance = Math.max(game.balance, INITIAL_BALANCE);
    setGame({
      ...game,
      balance: restoredBalance,
      round: createRound(round.id + 1),
      stats: {
        ...game.stats,
        refills: game.stats.refills + (restoredBalance > game.balance ? 1 : 0),
      },
    });
    setAim({ x: 0.5, y: 0.5 });
    setNotice("Fresh target. Balance ready, arrows cleared, and a new hotspot is waiting.");
  }

  function refill() {
    setGame({
      ...game,
      balance: round2(game.balance + 500),
      stats: { ...game.stats, refills: game.stats.refills + 1 },
    });
    setNotice("500 free demo credits added. Nothing here has cash value.");
  }

  function resetDemo() {
    if (!window.confirm("Reset the local balance, round, and all range stats?")) return;
    window.localStorage.removeItem(STORAGE_KEY);
    setGame(createGame());
    setAim({ x: 0.5, y: 0.5 });
    setNotice("Clean slate. A new exact hotspot is waiting.");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a href="#range" className="wordmark" aria-label="Hotspot game home">
          HOT<span>SPOT</span><sup>∞</sup>
        </a>
        <div className="demo-stamp">PLAY MONEY · LOCAL ONLY</div>
        <div className="wallet">
          <span><small>RANGE BALANCE</small><strong>{formatCredits(game.balance)}</strong></span>
          <button type="button" onClick={refill}>+500</button>
        </div>
      </header>

      <section className="headline">
        <div>
          <p>ARCHERY / DEDUCTION / PAYOUTS</p>
          <h1>UNLIMITED ARROWS.<br /><em>ONE HOTSPOT.</em></h1>
        </div>
        <p className="intro">
          Every payout is Bayesian evidence. Fire across 217 pins, watch the
          probability field reshape itself, and hunt the live posterior peak.
        </p>
      </section>

      <section className="range-layout" id="range">
        <aside className="brief-panel">
          <div className="round-id"><span>ROUND</span><strong>{String(round.id).padStart(2, "0")}</strong></div>

          <div className="mission">
            <span className="section-label">YOUR READ</span>
            <h2>READ THE SIGNAL. WATCH THE POSTERIOR. STRIKE THE PEAK.</h2>
            <ol>
              <li><b>01</b><span>Fire at any search pin.</span></li>
              <li><b>02</b><span>The exact payout updates all 217 probabilities.</span></li>
              <li><b>03</b><span>Acid-ringed open pins float above every arrow.</span></li>
            </ol>
          </div>

          <div className="hidden-parameters">
            <span className="section-label">ROUND PARAMETERS</span>
            <p><span>GOOD-PLAY RTP</span><b>99.00%</b></p>
            <p><span>EXACT POINT X / Y</span><b>{round.finished ? `${(hotspotPoint.x * 100).toFixed(1)} / ${(hotspotPoint.y * 100).toFixed(1)}` : "██.█ / ██.█"}</b></p>
            <p><span>OPENING HOTSPOT</span><b>{round.finished ? `${openingReward.toFixed(2)}×` : "█.██×"}</b></p>
            <p><span>SIGNAL RADIUS</span><b>{round.finished ? `${(round.hotspot.profile.radius * 100).toFixed(1)}%` : "██.█%"}</b></p>
            <p><span>NOISE FLOOR</span><b>{round.finished ? `${(round.hotspot.profile.noise * 100).toFixed(1)}%` : "█.█%"}</b></p>
            <p><span>MISS VARIANCE</span><b>{round.finished ? `${openingMissStats.variance.toFixed(4)}×²` : "█.████×²"}</b></p>
          </div>

          <button type="button" className="rules-button" onClick={() => setShowRules(true)}>
            OPEN THE BAYES MATH <span>↗</span>
          </button>
        </aside>

        <section className="target-stage">
          <div className="stage-topline">
            <span>{round.finished ? "EXACT HOTSPOT CAPTURED" : "LIVE TARGET · SHOTS SNAP TO PINS"}</span>
            <strong>{ARROW_STAKE} CREDITS / ARROW · NO LIMIT</strong>
          </div>

          <div className="target-wrap">
            <button
              type="button"
              className={`target-board ${round.finished ? "is-revealed" : ""}`}
              style={{ "--hit-x": `${hotspotPoint.x * 100}%`, "--hit-y": `${hotspotPoint.y * 100}%` } as CSSProperties}
              aria-label="Archery target with 217 search pins across the full board. Use pointer to aim and fire, or arrow keys to move the aim point and Enter to fire."
              onPointerMove={handlePointerMove}
              onPointerDown={handlePointerDown}
              onKeyDown={handleTargetKey}
              disabled={round.finished}
            >
              <span className="ring-groove groove-one" />
              <span className="ring-groove groove-two" />
              <span className="ring-groove groove-three" />

              {SEARCH_POINTS.map((point) => {
                const used = usedPointIds.has(point.id);
                const aimed = aimPoint.id === point.id && !round.finished && !used;
                const relativeProbability = topProbability > 0
                  ? round.posterior[point.id] / topProbability
                  : 0;
                const posteriorEmphasis = fieldConfidence * Math.sqrt(relativeProbability);
                const likely = fieldConfidence > 0.08 && relativeProbability >= 0.6;
                return (
                  <span
                    className={`search-pin ${likely ? "likely" : "possible"} ${used ? "used" : ""} ${aimed ? "aimed" : ""}`}
                    key={point.id}
                    style={{
                      left: `${point.x * 100}%`,
                      top: `${point.y * 100}%`,
                      opacity: used ? 1 : 0.62 + 0.38 * posteriorEmphasis,
                      transform: `translate(-50%,-50%) scale(${aimed ? 1.8 : used ? 1 : 0.78 + 0.72 * posteriorEmphasis})`,
                    }}
                  />
                );
              })}

              {round.finished && (
                <span className="hotspot-point" style={{ left: `${hotspotPoint.x * 100}%`, top: `${hotspotPoint.y * 100}%` }}>
                  <i /><b>EXACT HOTSPOT</b>
                </span>
              )}

              {round.finished && capturedShot && (
                <>
                  <span className="win-rays" style={{ left: `${hotspotPoint.x * 100}%`, top: `${hotspotPoint.y * 100}%` }}>
                    {Array.from({ length: 16 }, (_, index) => (
                      <i key={index} style={{ "--ray": `${index * 22.5}deg`, "--delay": `${index * 24}ms` } as CSSProperties} />
                    ))}
                  </span>
                  <span className="jackpot-impact">
                    <small>HOTSPOT CRACKED</small>
                    <strong>{capturedShot.multiplier.toFixed(2)}×</strong>
                    <em>+{formatCredits(capturedShot.returned)} CREDITS · {rewardQuality(openingReward)} TARGET</em>
                  </span>
                </>
              )}

              {round.shots.map((shot) => {
                const showPayoutLabel = round.finished || shot.number > round.shots.length - 6;
                return (
                  <span
                    aria-label={`Arrow ${shot.number}, ${shot.multiplier.toFixed(2)} multiplier`}
                    className={`arrow-mark ${shot.result}`}
                    key={shot.key}
                    style={{
                      left: `calc(${shot.x * 100}% + ${Math.cos(shot.number * 2.4) * (2 + shot.number % 4)}px)`,
                      top: `calc(${shot.y * 100}% + ${Math.sin(shot.number * 2.4) * (2 + shot.number % 4)}px)`,
                      "--angle": `${18 + (shot.number % 12) * 19}deg`,
                    } as CSSProperties}
                  >
                    <i /><b>{shot.number}</b>{showPayoutLabel && <em>{shot.multiplier.toFixed(2)}×</em>}
                  </span>
                );
              })}

              {!round.finished && (
                <span className="aim-reticle" style={{ left: `${aimPoint.x * 100}%`, top: `${aimPoint.y * 100}%` }}><i /></span>
              )}
            </button>
            <span className="target-caption caption-left">{openSlotCount} OPEN / 217 TOTAL</span>
            <span className="target-caption caption-right">RANGE 07</span>
          </div>

          <div className="open-slot-helper">
            <span><b>{openSlotCount}</b> OPEN PINS FLOAT ABOVE ARROWS</span>
            <div className="round-controls">
              <button type="button" className="reset-round-control" onClick={resetRound}>
                RESET ROUND <i>↻</i>
              </button>
              <button type="button" onClick={aimBestOpenPoint} disabled={round.finished || !bestOpenPoint}>
                AIM BEST OPEN PIN <i>→</i>
              </button>
            </div>
          </div>

          <div className="search-row" aria-label={`Posterior leader ${(topProbability * 100).toFixed(2)} percent with ${currentEntropy.toFixed(2)} bits of entropy`}>
            <div><span className="section-label">ARROWS FIRED</span><strong>{round.shots.length}</strong></div>
            <div><span className="section-label">POSTERIOR LEADER</span><strong>{(topProbability * 100).toFixed(2)}%</strong></div>
            <div><span className="section-label">AIM INFO</span><strong>{usedPointIds.has(aimPoint.id) ? "USED" : `${aimedInformation.toFixed(2)} bits`}</strong></div>
            <div><span className="section-label">AIM CHANCE / HIT</span><strong>{usedPointIds.has(aimPoint.id) ? "USED" : `${(aimProbability * 100).toFixed(2)}% / ${aimedReward.toFixed(2)}×`}</strong></div>
          </div>

          <div className="notice" aria-live="polite">
            <span className="pulse" /><p>{notice}</p>
            {bestClue && <strong>BIGGEST SIGNAL {bestClue.multiplier.toFixed(2)}×</strong>}
          </div>
        </section>

        <aside className="ledger-panel">
          <div className="ledger-title">
            <span>SHOT LEDGER</span>
            <button type="button" onClick={() => setGame({ ...game, sound: !game.sound })} aria-label={game.sound ? "Mute sound" : "Enable sound"}>
              {game.sound ? "SOUND ON" : "SOUND OFF"}
            </button>
          </div>

          <div className="round-return">
            <span>ROUND NET</span>
            <strong className={roundNet >= 0 ? "positive" : "negative"}>{roundNet >= 0 ? "+" : ""}{formatCredits(roundNet)}</strong>
            <small>demo credits</small>
          </div>

          <div className="shot-list">
            {round.shots.length === 0 ? (
              <div className="empty-ledger"><span>➶</span><p>Your search evidence<br />will appear here.</p></div>
            ) : (
              [...round.shots].reverse().map((shot) => (
                <div className="shot-row" key={shot.key}>
                  <span className={`shot-number ${shot.result}`}>{shot.number}</span>
                  <div>
                    <strong>{shot.multiplier.toFixed(2)}× · {resultLabel(shot.result)}</strong>
                    <small>{shot.result === "hit" ? `${(shot.hitChance * 100).toFixed(2)}% posterior at capture` : `${shot.entropyBefore.toFixed(2)} → ${shot.entropyAfter.toFixed(2)} bits · ${(shot.hitChance * 100).toFixed(2)}% aim`}</small>
                  </div>
                  <b className={shot.net >= 0 ? "positive" : "negative"}>{shot.net >= 0 ? "+" : ""}{formatCredits(shot.net)}</b>
                </div>
              ))
            )}
          </div>

          {round.finished && capturedShot ? (
            <div className="reveal-card">
              <span>HOTSPOT CAPTURED · {rewardQuality(openingReward)} / {varianceLabel(openingMissStats.variance)} VARIANCE</span>
              <h3>FOUND IN {round.shots.length} ARROWS.</h3>
              <p>The posterior assigned this pin a {(capturedShot.hitChance * 100).toFixed(2)}% chance before impact. The exact point paid {capturedShot.multiplier.toFixed(2)}×.</p>
              <div className="reveal-stats">
                <div><small>CAPTURE PAYOUT</small><strong>{capturedShot.multiplier.toFixed(2)}×</strong><em>FINAL ARROW</em></div>
                <div><small>OPENING VALUE</small><strong>{openingReward.toFixed(2)}×</strong><em>{rewardQuality(openingReward)} HOTSPOT</em></div>
                <div><small>MISS RANGE</small><strong>0.00–0.95×</strong><em>DUST OR BLAZE</em></div>
                <div><small>MISS VARIANCE</small><strong>{openingMissStats.variance.toFixed(4)}×²</strong><em>{varianceLabel(openingMissStats.variance)} SIGNAL</em></div>
                <div><small>SIGNAL RADIUS</small><strong>{(round.hotspot.profile.radius * 100).toFixed(1)}%</strong><em>GAUSSIAN σ</em></div>
                <div><small>NOISE / SHAPE</small><strong>{(round.hotspot.profile.noise * 100).toFixed(1)}% / {round.hotspot.profile.sharpness.toFixed(2)}</strong><em>FLOOR / EXPONENT</em></div>
                <div><small>INFORMATION GAIN</small><strong>{informationGain.toFixed(2)} bits</strong><em>{openingEntropy.toFixed(2)} → {currentEntropy.toFixed(2)}</em></div>
                <div><small>ARROWS USED</small><strong>{round.shots.length}</strong><em>UNLIMITED AVAILABLE</em></div>
                <div><small>REALIZED RTP</small><strong>{(realizedRtp * 100).toFixed(0)}%</strong><em>THIS HUNT</em></div>
              </div>
              <button type="button" onClick={startNextRound}>SET A NEW HOTSPOT →</button>
            </div>
          ) : (
            <div className="live-tip">
              <span>BAYES NOTE</span>
              <p>A 0.95× blaze strongly favors nearby pins; dust is more likely far away but never conclusive. Board brightness is the exact posterior after every signal.</p>
            </div>
          )}

          <details className="lifetime">
            <summary>LIFETIME / THIS DEVICE <span>+</span></summary>
            <div><small>Hotspots found</small><strong>{game.stats.rounds}</strong></div>
            <div><small>Arrows fired</small><strong>{game.stats.arrows}</strong></div>
            <div><small>Fastest find</small><strong>{game.stats.bestFind ? `${game.stats.bestFind} arrows` : "—"}</strong></div>
            <div><small>Best payout</small><strong>{game.stats.bestMultiplier.toFixed(2)}×</strong></div>
            <div><small>Net credits</small><strong className={lifetimeNet >= 0 ? "positive" : "negative"}>{lifetimeNet >= 0 ? "+" : ""}{formatCredits(lifetimeNet)}</strong></div>
          </details>

          <button type="button" className="reset-button" onClick={resetDemo}>RESET LOCAL DEMO</button>
        </aside>
      </section>

      <footer>
        <p>PLAY-MONEY PROTOTYPE · NO DEPOSITS · NO WITHDRAWALS · NO CASH VALUE</p>
        <p>EVERY OPEN PIN IS EXACTLY 99% EV · EVERY MISS PAYS LESS THAN 1×</p>
      </footer>

      {showRules && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="math-title">
          <div className="math-modal">
            <button type="button" className="modal-close" onClick={() => setShowRules(false)} aria-label="Close">×</button>
            <span className="modal-kicker">THE BAYESIAN HOUSE</span>
            <h2 id="math-title">EVERY PAYOUT<br />MOVES THE MAP.</h2>
            <p>The game maintains a probability p(h) for every unoccupied pin. A miss payout y has a distance-dependent likelihood L(y | d), built by blending cold and hot distributions through a randomized Gaussian signal field.</p>
            <div className="formula">
              <small>BAYES UPDATE AFTER AIM a RETURNS PAYOUT y</small>
              <strong>p′(h) ∝ p(h) · L(y | d(a,h))</strong>
            </div>
            <div className="parameter-grid">
              <div><span>HIT CHANCE</span><strong>p(a)</strong><p>The live posterior mass at the pin you choose.</p></div>
              <div><span>MISS SIGNAL</span><strong>L(y | d)</strong><p>Eight payouts from 0.00× to 0.95× carry noisy spatial evidence.</p></div>
              <div><span>INFORMATION</span><strong>Δ entropy</strong><p>Skill means choosing shots that collapse uncertainty quickly.</p></div>
              <div><span>USED SLOT</span><strong>BLOCKED</strong><p>An occupied pin cannot be fired at again and costs nothing.</p></div>
            </div>
            <div className="formula formula-secondary">
              <small>LIVE HIT REWARD FOR AIM a</small>
              <strong>J(a) = [0.99 − Σ<sub>h ≠ a</sub> p(h) μ(a,h)] / p(a)</strong>
            </div>
            <p className="math-note">The miss term μ(a,h) is the expected payout at that exact distance. Therefore p(a)J(a) + Σp(h)μ(a,h) = 0.99 for every open pin—not just for one prescribed strategy. The strategy problem is information-theoretic: minimize the number of 1%-edge wagers needed to localize the hotspot.</p>
            <button type="button" className="close-primary" onClick={() => setShowRules(false)}>BACK TO THE RANGE</button>
          </div>
        </div>
      )}
    </main>
  );
}
