"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

const STORAGE_KEY = "hotspot-archery-state-v6";
const LEGACY_STORAGE_KEYS = [
  "fourtune-vaults-state-v1",
  "hotspot-archery-state-v1",
  "hotspot-archery-state-v2",
  "hotspot-archery-state-v3",
  "hotspot-archery-state-v4",
  "hotspot-archery-state-v5",
];
const ARROW_STAKE = 10;
const TARGET_RTP = 0.99;
const TARGET_RADIUS = 0.495;
const MIN_HEAT_BUCKET = 16;
const DUST_PAYOUTS = [0, 0.01, 0.02] as const;
const BURST_PAYOUTS = [0.55, 0.65, 0.75, 0.85, 0.95] as const;
const DUST_MEAN = 0.01;
const BURST_MEAN = 0.75;

type Point = { x: number; y: number };
type SearchPoint = Point & { id: number };
type HeatBand = "cold" | "cool" | "warm" | "near";

type RewardProfile = Record<HeatBand, number>;

type Hotspot = {
  pointId: number;
  profile: RewardProfile;
};

type Shot = SearchPoint & {
  key: number;
  number: number;
  multiplier: number;
  returned: number;
  net: number;
  distance: number;
  result: HeatBand | "hit" | "repeat";
  possibleBefore: number;
  possibleAfter: number;
  rewardOnAim: number;
};

type Round = {
  id: number;
  hotspot: Hotspot;
  possibleIds: number[];
  shots: Shot[];
  finished: boolean;
};

type GameState = {
  version: 6;
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
  const radius = 6;
  const spacing = 0.062;

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

function createRewardProfile(): RewardProfile {
  const cold = round2(randomBetween(0.02, 0.04));
  const cool = round2(randomBetween(0.05, 0.08));
  const warm = round2(randomBetween(0.1, 0.14));
  const near = round2(randomBetween(0.17, 0.22));
  return { cold, cool, warm, near };
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

function heatBandsForAim(
  aimedPointId: number,
  possibleIds: number[],
) {
  const aimedPoint = pointById(aimedPointId);
  const candidates = possibleIds
    .filter((possibleId) => possibleId !== aimedPointId)
    .sort((aId, bId) => {
      const separation = distance(aimedPoint, pointById(aId)) - distance(aimedPoint, pointById(bId));
      return separation || aId - bId;
    });
  const bandCount = Math.min(
    4,
    Math.max(1, Math.floor(candidates.length / MIN_HEAT_BUCKET)),
  );
  const labels: Record<number, HeatBand[]> = {
    1: ["cold"],
    2: ["near", "cold"],
    3: ["near", "warm", "cold"],
    4: ["near", "warm", "cool", "cold"],
  };
  const bands = new Map<number, HeatBand>();

  candidates.forEach((candidateId, index) => {
    const bucket = Math.min(
      bandCount - 1,
      Math.floor((index * bandCount) / candidates.length),
    );
    bands.set(candidateId, labels[bandCount][bucket]);
  });

  return bands;
}

function sampleMissMultiplier(expectedMean: number) {
  const burstChance = (expectedMean - DUST_MEAN) / (BURST_MEAN - DUST_MEAN);
  const payouts = randomUnit() < burstChance ? BURST_PAYOUTS : DUST_PAYOUTS;
  return payouts[Math.floor(randomUnit() * payouts.length)];
}

function captureReward(
  aimedPointId: number,
  possibleIds: number[],
  profile: RewardProfile,
) {
  if (!possibleIds.includes(aimedPointId)) return profile.cold;
  const bands = heatBandsForAim(aimedPointId, possibleIds);
  const missTotal = possibleIds.reduce((total, possibleId) => {
    if (possibleId === aimedPointId) return total;
    return total + profile[bands.get(possibleId) ?? "cold"];
  }, 0);
  return round2(TARGET_RTP * possibleIds.length - missTotal);
}

function createRound(id: number): Round {
  return {
    id,
    hotspot: {
      pointId: Math.floor(randomUnit() * SEARCH_POINTS.length),
      profile: createRewardProfile(),
    },
    possibleIds: [...ALL_POINT_IDS],
    shots: [],
    finished: false,
  };
}

function createGame(): GameState {
  return {
    version: 6,
    balance: 500,
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
  if (result === "repeat") return "NO NEW READ";
  return `${result.toUpperCase()} READ`;
}

function rewardQuality(multiplier: number) {
  if (multiplier >= 100) return "LEGENDARY";
  if (multiplier >= 80) return "MASSIVE";
  if (multiplier >= 50) return "RICH";
  return "VOLATILE";
}

function profileVariance(profile: RewardProfile) {
  const means = Object.values(profile);
  const mean = means.reduce((total, value) => total + value, 0) / means.length;
  const dustSecondMoment = DUST_PAYOUTS.reduce((total, value) => total + value ** 2, 0) / DUST_PAYOUTS.length;
  const burstSecondMoment = BURST_PAYOUTS.reduce((total, value) => total + value ** 2, 0) / BURST_PAYOUTS.length;
  const secondMoment = means.reduce((total, expectedMean) => {
    const burstChance = (expectedMean - DUST_MEAN) / (BURST_MEAN - DUST_MEAN);
    return total + (1 - burstChance) * dustSecondMoment + burstChance * burstSecondMoment;
  }, 0) / means.length;
  return secondMoment - mean ** 2;
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
    cold: 165,
    cool: 220,
    warm: 310,
    near: 430,
    repeat: 125,
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
    "Pick a search pin. Most misses return dust; rare misses burst as high as 0.95×.",
  );
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      try {
        LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as GameState;
          if (parsed.version === 6 && parsed.round?.hotspot) {
            setGame(parsed);
            setNotice(
              parsed.round.finished
                ? `Hotspot captured in ${parsed.round.shots.length} arrows.`
                : `${parsed.round.possibleIds.length} exact points remain possible.`,
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
    const misses = game?.round.shots.filter(
      (shot) => shot.result !== "hit" && shot.result !== "repeat",
    ) ?? [];
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
  const rewardValues = round.possibleIds.map((pointId) =>
    captureReward(pointId, round.possibleIds, round.hotspot.profile),
  );
  const rewardLow = Math.min(...rewardValues);
  const rewardHigh = Math.max(...rewardValues);
  const openingReward = captureReward(
    round.hotspot.pointId,
    ALL_POINT_IDS,
    round.hotspot.profile,
  );
  const capturedShot = round.shots.find((shot) => shot.result === "hit") ?? null;
  const roundNet = round.shots.reduce((sum, shot) => sum + shot.net, 0);
  const roundReturned = round.shots.reduce((sum, shot) => sum + shot.returned, 0);
  const realizedRtp = round.shots.length
    ? roundReturned / (round.shots.length * ARROW_STAKE)
    : 0;
  const lifetimeNet = game.stats.returned - game.stats.wagered;
  const missVariance = profileVariance(round.hotspot.profile);
  const missSpread = round.hotspot.profile.near - round.hotspot.profile.cold;

  function shoot(point: Point) {
    if (!game || game.round.finished || game.balance < ARROW_STAKE) return;
    if (distance(point, { x: 0.5, y: 0.5 }) > TARGET_RADIUS) {
      setNotice("That aim sits outside the target. Pull it inside the outer ring.");
      return;
    }

    const selected = nearestSearchPoint(point);
    const isPossible = round.possibleIds.includes(selected.id);
    const isHit = isPossible && selected.id === round.hotspot.pointId;
    const bands = heatBandsForAim(selected.id, round.possibleIds);
    const rewardOnAim = isPossible
      ? captureReward(selected.id, round.possibleIds, round.hotspot.profile)
      : round.hotspot.profile.cold;
    let result: Shot["result"];
    let multiplier: number;
    let nextPossibleIds = round.possibleIds;

    if (isHit) {
      result = "hit";
      multiplier = rewardOnAim;
    } else if (!isPossible) {
      result = "repeat";
      multiplier = sampleMissMultiplier(round.hotspot.profile.cold);
    } else {
      result = bands.get(round.hotspot.pointId) ?? "cold";
      multiplier = sampleMissMultiplier(round.hotspot.profile[result]);
      nextPossibleIds = round.possibleIds.filter((possibleId) =>
        possibleId !== selected.id &&
        bands.get(possibleId) === result,
      );
    }

    const returned = round2(ARROW_STAKE * multiplier);
    const net = round2(returned - ARROW_STAKE);
    const shotNumber = round.shots.length + 1;
    const shot: Shot = {
      ...selected,
      key: Date.now() + shotNumber,
      number: shotNumber,
      multiplier,
      returned,
      net,
      distance: distance(selected, hotspotPoint),
      result,
      possibleBefore: round.possibleIds.length,
      possibleAfter: isHit ? 1 : nextPossibleIds.length,
      rewardOnAim,
    };

    setGame({
      ...game,
      balance: round2(game.balance + net),
      round: {
        ...round,
        possibleIds: isHit ? [round.hotspot.pointId] : nextPossibleIds,
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
      },
    });

    playTone(game.sound, result, multiplier);
    if (isHit) {
      setNotice(`Bullseye found in ${shotNumber} arrows — ${multiplier.toFixed(2)}× captured.`);
    } else if (result === "repeat") {
      setNotice(`Dead pin. Its volatile miss paid ${multiplier.toFixed(2)}× and added no new evidence.`);
    } else {
      setNotice(
        `${multiplier.toFixed(2)}× ${result} read — ${nextPossibleIds.length} exact points remain.`,
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
    setNotice("Fresh target. The exact hotspot and reward curve have both moved.");
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
          Hunt one exact point among 127 pins. Most misses pay 0.00–0.02×; rare
          bursts jump as high as 0.95×. Hit the hotspot for the real jackpot.
        </p>
      </section>

      <section className="range-layout" id="range">
        <aside className="brief-panel">
          <div className="round-id"><span>ROUND</span><strong>{String(round.id).padStart(2, "0")}</strong></div>

          <div className="mission">
            <span className="section-label">YOUR READ</span>
            <h2>FOLLOW THE HEAT. RULE OUT PINS. HIT FAST.</h2>
            <ol>
              <li><b>01</b><span>Fire at any search pin.</span></li>
              <li><b>02</b><span>Heat changes the odds of a rare payout burst.</span></li>
              <li><b>03</b><span>Every arrow remains pinned until the reveal.</span></li>
            </ol>
          </div>

          <div className="hidden-parameters">
            <span className="section-label">ROUND PARAMETERS</span>
            <p><span>GOOD-PLAY RTP</span><b>99.00%</b></p>
            <p><span>EXACT POINT X / Y</span><b>{round.finished ? `${(hotspotPoint.x * 100).toFixed(1)} / ${(hotspotPoint.y * 100).toFixed(1)}` : "██.█ / ██.█"}</b></p>
            <p><span>OPENING HOTSPOT</span><b>{round.finished ? `${openingReward.toFixed(2)}×` : "█.██×"}</b></p>
            <p><span>MISS RANGE</span><b>{round.finished ? "0.00–0.95×" : "█.██–█.██×"}</b></p>
            <p><span>MISS VARIANCE</span><b>{round.finished ? `${missVariance.toFixed(4)}×²` : "█.████×²"}</b></p>
          </div>

          <button type="button" className="rules-button" onClick={() => setShowRules(true)}>
            WHY GOOD PLAY IS 99% <span>↗</span>
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
              aria-label="Archery target with 127 search pins. Use pointer to aim and fire, or arrow keys to move the aim point and Enter to fire."
              onPointerMove={handlePointerMove}
              onPointerDown={handlePointerDown}
              onKeyDown={handleTargetKey}
              disabled={round.finished || game.balance < ARROW_STAKE}
            >
              <span className="ring-groove groove-one" />
              <span className="ring-groove groove-two" />
              <span className="ring-groove groove-three" />

              {SEARCH_POINTS.map((point) => {
                const possible = round.possibleIds.includes(point.id);
                return (
                  <span
                    className={`search-pin ${possible ? "possible" : "eliminated"} ${aimPoint.id === point.id && !round.finished ? "aimed" : ""}`}
                    key={point.id}
                    style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
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

              {round.shots.map((shot) => (
                <span
                  className={`arrow-mark ${shot.result}`}
                  key={shot.key}
                  style={{
                    left: `calc(${shot.x * 100}% + ${Math.cos(shot.number * 2.4) * (2 + shot.number % 4)}px)`,
                    top: `calc(${shot.y * 100}% + ${Math.sin(shot.number * 2.4) * (2 + shot.number % 4)}px)`,
                    "--angle": `${18 + (shot.number % 12) * 19}deg`,
                  } as CSSProperties}
                >
                  <i /><b>{shot.number}</b><em>{shot.multiplier.toFixed(2)}×</em>
                </span>
              ))}

              {!round.finished && (
                <span className="aim-reticle" style={{ left: `${aimPoint.x * 100}%`, top: `${aimPoint.y * 100}%` }}><i /></span>
              )}
            </button>
            <span className="target-caption caption-left">127 EXACT PINS</span>
            <span className="target-caption caption-right">RANGE 07</span>
          </div>

          <div className="search-row" aria-label={`${round.possibleIds.length} hotspot locations remain possible`}>
            <div><span className="section-label">ARROWS FIRED</span><strong>{round.shots.length}</strong></div>
            <div><span className="section-label">POSSIBLE POINTS</span><strong>{round.possibleIds.length} / {SEARCH_POINTS.length}</strong></div>
            <div><span className="section-label">HIT REWARD NOW</span><strong>{rewardLow.toFixed(2)}–{rewardHigh.toFixed(2)}×</strong></div>
          </div>

          <div className="notice" aria-live="polite">
            <span className="pulse" /><p>{notice}</p>
            {bestClue && <strong>HOTTEST MISS {bestClue.multiplier.toFixed(2)}×</strong>}
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
                    <small>{shot.result === "hit" ? `${shot.possibleBefore} possible before capture` : shot.result === "repeat" ? "ruled-out pin repeated" : `${shot.possibleBefore} → ${shot.possibleAfter} possible`}</small>
                  </div>
                  <b className={shot.net >= 0 ? "positive" : "negative"}>{shot.net >= 0 ? "+" : ""}{formatCredits(shot.net)}</b>
                </div>
              ))
            )}
          </div>

          {round.finished && capturedShot ? (
            <div className="reveal-card">
              <span>HOTSPOT CAPTURED · {rewardQuality(openingReward)} / {varianceLabel(missVariance)} VARIANCE</span>
              <h3>FOUND IN {round.shots.length} ARROWS.</h3>
              <p>The exact point paid {capturedShot.multiplier.toFixed(2)}×. Faster deductions expose the prize while more uncertainty—and more upside—still remains.</p>
              <div className="reveal-stats">
                <div><small>CAPTURE PAYOUT</small><strong>{capturedShot.multiplier.toFixed(2)}×</strong><em>FINAL ARROW</em></div>
                <div><small>OPENING VALUE</small><strong>{openingReward.toFixed(2)}×</strong><em>{rewardQuality(openingReward)} HOTSPOT</em></div>
                <div><small>MISS RANGE</small><strong>0.00–0.95×</strong><em>DUST OR BURST</em></div>
                <div><small>MISS VARIANCE</small><strong>{missVariance.toFixed(4)}×²</strong><em>{varianceLabel(missVariance)} SIGNAL</em></div>
                <div><small>HEAT MEAN EDGE</small><strong>{missSpread.toFixed(2)}×</strong><em>{round.hotspot.profile.cold.toFixed(2)}–{round.hotspot.profile.near.toFixed(2)}×</em></div>
                <div><small>ARROWS USED</small><strong>{round.shots.length}</strong><em>UNLIMITED AVAILABLE</em></div>
                <div><small>REALIZED RTP</small><strong>{(realizedRtp * 100).toFixed(0)}%</strong><em>THIS HUNT</em></div>
              </div>
              <button type="button" onClick={startNextRound}>SET A NEW HOTSPOT →</button>
            </div>
          ) : (
            <div className="live-tip">
              <span>RANGE NOTE</span>
              <p>Hotter reads make a rare payout burst more likely. Every fresh possible pin is exactly 99% EV; your edge is needing fewer wagers to solve the board.</p>
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
        <p>FRESH POSSIBLE SHOTS ARE EXACTLY 99% EV · EVERY MISS PAYS LESS THAN 1×</p>
      </footer>

      {showRules && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="math-title">
          <div className="math-modal">
            <button type="button" className="modal-close" onClick={() => setShowRules(false)} aria-label="Close">×</button>
            <span className="modal-kicker">THE 99% PROOF</span>
            <h2 id="math-title">EVERY GOOD SHOT.<br />EXACTLY 99% EV.</h2>
            <p>The hotspot is one exact point among the pins still consistent with your previous heat readings. Each miss returns either dust at 0.00–0.02× or a rare burst from 0.55–0.95×. Hotter reads make a burst more likely.</p>
            <div className="formula">
              <small>JACKPOT FOR AIM POINT a WITH N POSSIBILITIES</small>
              <strong>J(a) = 0.99N − Σ<sub>h ≠ a</sub> m(a,h)</strong>
            </div>
            <div className="parameter-grid">
              <div><span>GOOD SHOT</span><strong>a ∈ S</strong><p>Aim at any point that remains possible.</p></div>
              <div><span>HIT CHANCE</span><strong>1 / N</strong><p>The secret is uniform over the surviving set.</p></div>
              <div><span>EVERY MISS</span><strong>0.00–0.95×</strong><p>Most are nearly zero; rare bursts create the extreme variance.</p></div>
              <div><span>BAD REPEAT</span><strong>DUST / BURST</strong><p>The same volatile miss draw, with no new information.</p></div>
            </div>
            <p className="math-note">Here m(a,h) is the expected miss return, including its dust-or-burst draw. For a fresh possible point, E[M] = [J(a) + Σm(a,h)] / N = 0.99 exactly. Adaptive distance buckets keep each surviving set uniform and stop clues from collapsing the jackpot straight to 1×.</p>
            <button type="button" className="close-primary" onClick={() => setShowRules(false)}>BACK TO THE RANGE</button>
          </div>
        </div>
      )}
    </main>
  );
}
