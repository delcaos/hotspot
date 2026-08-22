"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

const STORAGE_KEY = "hotspot-archery-state-v5";
const LEGACY_STORAGE_KEYS = [
  "fourtune-vaults-state-v1",
  "hotspot-archery-state-v1",
  "hotspot-archery-state-v2",
  "hotspot-archery-state-v3",
  "hotspot-archery-state-v4",
];
const ARROW_STAKE = 10;
const TARGET_RTP = 0.99;
const REPEAT_PAYOUT = 0.96;
const TARGET_RADIUS = 0.495;

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
  version: 5;
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
  const cold = round2(randomBetween(0.03, 0.08));
  const cool = round2(randomBetween(0.16, 0.3));
  const warm = round2(randomBetween(0.4, 0.62));
  const near = round2(randomBetween(0.78, 0.94));
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

function heatBandBetween(a: SearchPoint, b: SearchPoint): HeatBand {
  const separation = distance(a, b);
  if (separation <= 0.1) return "near";
  if (separation <= 0.19) return "warm";
  if (separation <= 0.31) return "cool";
  return "cold";
}

function missMultiplier(
  aimedPointId: number,
  hotspotPointId: number,
  profile: RewardProfile,
) {
  const band = heatBandBetween(pointById(aimedPointId), pointById(hotspotPointId));
  return { band, multiplier: profile[band] };
}

function captureReward(
  aimedPointId: number,
  possibleIds: number[],
  profile: RewardProfile,
) {
  if (!possibleIds.includes(aimedPointId)) return REPEAT_PAYOUT;
  const missTotal = possibleIds.reduce((total, possibleId) => {
    if (possibleId === aimedPointId) return total;
    return total + missMultiplier(aimedPointId, possibleId, profile).multiplier;
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
    version: 5,
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
  const values = Object.values(profile);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
}

function varianceLabel(variance: number) {
  if (variance >= 0.075) return "EXTREME";
  if (variance >= 0.04) return "WILD";
  if (variance >= 0.015) return "HIGH";
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
    "Pick a search pin. Misses swing hard, but every result narrows the field.",
  );
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      try {
        LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as GameState;
          if (parsed.version === 5 && parsed.round?.hotspot) {
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
    const rewardOnAim = captureReward(
      selected.id,
      round.possibleIds,
      round.hotspot.profile,
    );
    let result: Shot["result"];
    let multiplier: number;
    let nextPossibleIds = round.possibleIds;

    if (isHit) {
      result = "hit";
      multiplier = rewardOnAim;
    } else if (!isPossible) {
      result = "repeat";
      multiplier = REPEAT_PAYOUT;
    } else {
      const miss = missMultiplier(
        selected.id,
        round.hotspot.pointId,
        round.hotspot.profile,
      );
      result = miss.band;
      multiplier = miss.multiplier;
      nextPossibleIds = round.possibleIds.filter((possibleId) =>
        possibleId !== selected.id &&
        heatBandBetween(selected, pointById(possibleId)) === miss.band,
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
      setNotice("That pin was already ruled out. It paid 0.96× and added no new evidence.");
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
          Hunt one exact point among 127 pins. Misses can hit brutally different
          returns. Find it quickly while the hotspot jackpot is still enormous.
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
              <li><b>02</b><span>Near misses cushion you. Cold misses hit hard.</span></li>
              <li><b>03</b><span>Use fresh evidence; repeats cost.</span></li>
            </ol>
          </div>

          <div className="hidden-parameters">
            <span className="section-label">ROUND PARAMETERS</span>
            <p><span>GOOD-PLAY RTP</span><b>99.00%</b></p>
            <p><span>EXACT POINT X / Y</span><b>{round.finished ? `${(hotspotPoint.x * 100).toFixed(1)} / ${(hotspotPoint.y * 100).toFixed(1)}` : "██.█ / ██.█"}</b></p>
            <p><span>OPENING HOTSPOT</span><b>{round.finished ? `${openingReward.toFixed(2)}×` : "█.██×"}</b></p>
            <p><span>MISS RANGE</span><b>{round.finished ? `${round.hotspot.profile.cold.toFixed(2)}–${round.hotspot.profile.near.toFixed(2)}×` : "█.██–█.██×"}</b></p>
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

              {round.shots.slice(-20).map((shot) => (
                <span
                  className={`arrow-mark ${shot.result}`}
                  key={shot.key}
                  style={{ left: `${shot.x * 100}%`, top: `${shot.y * 100}%`, "--angle": `${18 + (shot.number % 12) * 19}deg` } as CSSProperties}
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
                <div><small>MISS SPREAD</small><strong>{missSpread.toFixed(2)}×</strong><em>{round.hotspot.profile.cold.toFixed(2)}–{round.hotspot.profile.near.toFixed(2)}×</em></div>
                <div><small>MISS VARIANCE</small><strong>{missVariance.toFixed(4)}×²</strong><em>{varianceLabel(missVariance)} SIGNAL</em></div>
                <div><small>ARROWS USED</small><strong>{round.shots.length}</strong><em>UNLIMITED AVAILABLE</em></div>
                <div><small>REALIZED RTP</small><strong>{(realizedRtp * 100).toFixed(0)}%</strong><em>THIS HUNT</em></div>
              </div>
              <button type="button" onClick={startNextRound}>SET A NEW HOTSPOT →</button>
            </div>
          ) : (
            <div className="live-tip">
              <span>RANGE NOTE</span>
              <p>Nearer misses pay more. Every fresh possible pin is exactly 99% EV; your edge is needing fewer wagers to solve the board.</p>
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
            <p>The hotspot is one exact point among the pins still consistent with your previous heat readings. A cold, cool, warm, or near miss pays less than 1× and removes every point that could not have produced that reading.</p>
            <div className="formula">
              <small>JACKPOT FOR AIM POINT a WITH N POSSIBILITIES</small>
              <strong>J(a) = 0.99N − Σ<sub>h ≠ a</sub> m(a,h)</strong>
            </div>
            <div className="parameter-grid">
              <div><span>GOOD SHOT</span><strong>a ∈ S</strong><p>Aim at any point that remains possible.</p></div>
              <div><span>HIT CHANCE</span><strong>1 / N</strong><p>The secret is uniform over the surviving set.</p></div>
              <div><span>EVERY MISS</span><strong>0.03–0.94×</strong><p>The extreme randomized heat curve is always below break-even.</p></div>
              <div><span>BAD REPEAT</span><strong>0.96×</strong><p>A gentle penalty with no new information.</p></div>
            </div>
            <p className="math-note">For a fresh possible point, E[M] = [J(a) + Σm(a,h)] / N = 0.99 exactly. After a miss, the observed heat band creates a smaller uniform possibility set, so the same proof applies again. Strategy changes how many wagers you need—not the 99% expected return of a well-chosen arrow.</p>
            <button type="button" className="close-primary" onClick={() => setShowRules(false)}>BACK TO THE RANGE</button>
          </div>
        </div>
      )}
    </main>
  );
}
