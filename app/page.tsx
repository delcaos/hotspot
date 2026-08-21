"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

const STORAGE_KEY = "hotspot-archery-state-v3";
const LEGACY_STORAGE_KEYS = [
  "fourtune-vaults-state-v1",
  "hotspot-archery-state-v1",
  "hotspot-archery-state-v2",
];
const ARROW_STAKE = 10;
const QUIVER_SIZE = 10;
const TARGET_BOARD_RTP = 0.99;
const FALLOFF_SIGMA = 0.14;
const TARGET_RADIUS = 0.495;

type Point = { x: number; y: number };

type Hotspot = Point & {
  peakRtp: number;
  payoutNoise: number;
  baseRtp: number;
  kernelMean: number;
};

type Shot = Point & {
  id: number;
  number: number;
  meanRtp: number;
  multiplier: number;
  returned: number;
  net: number;
  distance: number;
};

type Round = {
  id: number;
  hotspot: Hotspot;
  shots: Shot[];
  finished: boolean;
};

type GameState = {
  version: 3;
  balance: number;
  round: Round;
  sound: boolean;
  stats: {
    rounds: number;
    arrows: number;
    wagered: number;
    returned: number;
    bestMultiplier: number;
    refills: number;
  };
};

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

function estimateKernelMean(point: Point) {
  const gridSize = 121;
  let total = 0;
  let samples = 0;

  for (let row = 0; row < gridSize; row += 1) {
    const y = (row + 0.5) / gridSize;
    for (let column = 0; column < gridSize; column += 1) {
      const x = (column + 0.5) / gridSize;
      if (distance({ x, y }, { x: 0.5, y: 0.5 }) > TARGET_RADIUS) continue;
      const distanceSquared = (x - point.x) ** 2 + (y - point.y) ** 2;
      total += Math.exp(-distanceSquared / (2 * FALLOFF_SIGMA ** 2));
      samples += 1;
    }
  }

  return total / samples;
}

function createHotspot(): Hotspot {
  const angle = randomUnit() * Math.PI * 2;
  const radius = Math.sqrt(randomUnit()) * 0.3;
  const point = {
    x: 0.5 + Math.cos(angle) * radius,
    y: 0.5 + Math.sin(angle) * radius,
  };
  const peakRtp = randomBetween(2.4, 4.4);
  const kernelMean = estimateKernelMean(point);
  const baseRtp =
    (TARGET_BOARD_RTP - peakRtp * kernelMean) / (1 - kernelMean);

  return {
    ...point,
    peakRtp,
    payoutNoise: randomBetween(0.16, 0.55),
    baseRtp,
    kernelMean,
  };
}

function createRound(id: number): Round {
  return { id, hotspot: createHotspot(), shots: [], finished: false };
}

function createGame(): GameState {
  return {
    version: 3,
    balance: 500,
    round: createRound(1),
    sound: true,
    stats: {
      rounds: 0,
      arrows: 0,
      wagered: 0,
      returned: 0,
      bestMultiplier: 0,
      refills: 0,
    },
  };
}

function localMeanRtp(point: Point, hotspot: Hotspot) {
  const distanceSquared =
    (point.x - hotspot.x) ** 2 + (point.y - hotspot.y) ** 2;
  return (
    hotspot.baseRtp +
    (hotspot.peakRtp - hotspot.baseRtp) *
      Math.exp(-distanceSquared / (2 * FALLOFF_SIGMA ** 2))
  );
}

function samplePayout(meanRtp: number, payoutNoise: number) {
  const meanOneNoise =
    1 + payoutNoise * Math.sqrt(3) * (2 * randomUnit() - 1);
  return Math.max(0, Math.round(meanRtp * meanOneNoise * 20) / 20);
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function formatCredits(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function multiplierClass(multiplier: number) {
  if (multiplier >= 2) return "scorching";
  if (multiplier >= 1) return "warm";
  if (multiplier >= 0.65) return "cool";
  return "cold";
}

function qualityLabel(peakRtp: number) {
  if (peakRtp >= 4) return "ELITE";
  if (peakRtp >= 3.4) return "VERY RICH";
  if (peakRtp >= 2.9) return "RICH";
  return "GOOD";
}

function varianceLabel(payoutNoise: number) {
  if (payoutNoise >= 0.45) return "HIGH";
  if (payoutNoise >= 0.3) return "MEDIUM";
  return "LOW";
}

function playTone(enabled: boolean, multiplier: number | "reveal") {
  if (!enabled || typeof window === "undefined" || !window.AudioContext) return;
  const context = new window.AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const frequency =
    multiplier === "reveal" ? 700 : 150 + Math.min(multiplier, 5) * 130;
  oscillator.frequency.setValueAtTime(frequency, context.currentTime);
  oscillator.type = multiplier === "reveal" ? "triangle" : "sine";
  gain.gain.setValueAtTime(0.055, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    context.currentTime + (multiplier === "reveal" ? 0.55 : 0.2),
  );
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + (multiplier === "reveal" ? 0.55 : 0.2));
  oscillator.addEventListener("ended", () => void context.close());
}

export default function Home() {
  const [game, setGame] = useState<GameState | null>(null);
  const [aim, setAim] = useState<Point>({ x: 0.5, y: 0.5 });
  const [notice, setNotice] = useState(
    "Click anywhere on the target to loose your first arrow.",
  );
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      try {
        LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as GameState;
          if (parsed.version === 3 && parsed.round?.hotspot) {
            setGame(parsed);
            setNotice(
              parsed.round.finished
                ? "The hotspot is revealed. Study the pattern, then start a new round."
                : `${QUIVER_SIZE - parsed.round.shots.length} arrows remain in this quiver.`,
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

  const bestShot = useMemo(() => {
    if (!game?.round.shots.length) return null;
    return game.round.shots.reduce((best, shot) =>
      shot.multiplier > best.multiplier ? shot : best,
    );
  }, [game]);

  const closestShot = useMemo(() => {
    if (!game?.round.shots.length) return null;
    return game.round.shots.reduce((best, shot) =>
      shot.distance < best.distance ? shot : best,
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
  const arrowsLeft = QUIVER_SIZE - round.shots.length;
  const roundNet = round.shots.reduce((sum, shot) => sum + shot.net, 0);
  const lifetimeNet = game.stats.returned - game.stats.wagered;
  const hotspotStdDev = round.hotspot.peakRtp * round.hotspot.payoutNoise;
  const hotspotVariance = hotspotStdDev ** 2;
  const roundReturned = round.shots.reduce((sum, shot) => sum + shot.returned, 0);
  const realizedRtp = round.shots.length
    ? roundReturned / (round.shots.length * ARROW_STAKE)
    : 0;

  function shoot(point: Point) {
    if (!game || game.round.finished || game.balance < ARROW_STAKE) return;
    if (distance(point, { x: 0.5, y: 0.5 }) > TARGET_RADIUS) {
      setNotice("That aim sits outside the target. Pull it inside the outer ring.");
      return;
    }

    const meanRtp = localMeanRtp(point, game.round.hotspot);
    const multiplier = samplePayout(meanRtp, game.round.hotspot.payoutNoise);
    const returned = Math.round(ARROW_STAKE * multiplier);
    const shotNumber = game.round.shots.length + 1;
    const lastArrow = shotNumber === QUIVER_SIZE;
    const net = returned - ARROW_STAKE;
    const shot: Shot = {
      ...point,
      id: Date.now() + shotNumber,
      number: shotNumber,
      meanRtp,
      multiplier,
      returned,
      net,
      distance: distance(point, game.round.hotspot),
    };

    setGame({
      ...game,
      balance: game.balance + net,
      round: {
        ...game.round,
        shots: [...game.round.shots, shot],
        finished: lastArrow,
      },
      stats: {
        ...game.stats,
        rounds: game.stats.rounds + (lastArrow ? 1 : 0),
        arrows: game.stats.arrows + 1,
        wagered: game.stats.wagered + ARROW_STAKE,
        returned: game.stats.returned + returned,
        bestMultiplier: Math.max(game.stats.bestMultiplier, multiplier),
      },
    });

    if (lastArrow) {
      setNotice("Quiver empty. The hidden field is now revealed.");
      playTone(game.sound, "reveal");
    } else if (multiplier >= 2) {
      setNotice(`${multiplier.toFixed(2)}× — scorching. Search around arrow ${shotNumber}.`);
      playTone(game.sound, multiplier);
    } else if (multiplier >= 1) {
      setNotice(`${multiplier.toFixed(2)}× — warm evidence, but the noise can bluff.`);
      playTone(game.sound, multiplier);
    } else {
      setNotice(`${multiplier.toFixed(2)}× — a cold read. ${QUIVER_SIZE - shotNumber} arrows left.`);
      playTone(game.sound, multiplier);
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
      shoot(aim);
      return;
    } else return;
    event.preventDefault();
    setAim(next);
  }

  function startNextRound() {
    if (!game) return;
    setGame({ ...game, round: createRound(game.round.id + 1) });
    setAim({ x: 0.5, y: 0.5 });
    setNotice("Fresh target. The hotspot has moved—and changed shape.");
  }

  function refill() {
    if (!game) return;
    setGame({
      ...game,
      balance: game.balance + 500,
      stats: { ...game.stats, refills: game.stats.refills + 1 },
    });
    setNotice("500 free demo credits added. Nothing here has cash value.");
  }

  function resetDemo() {
    if (!window.confirm("Reset the local balance, round, and all range stats?")) return;
    window.localStorage.removeItem(STORAGE_KEY);
    setGame(createGame());
    setAim({ x: 0.5, y: 0.5 });
    setNotice("Clean slate. A new hidden field is waiting.");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a href="#range" className="wordmark" aria-label="Hotspot game home">
          HOT<span>SPOT</span><sup>10</sup>
        </a>
        <div className="demo-stamp">PLAY MONEY · LOCAL ONLY</div>
        <div className="wallet">
          <span>
            <small>RANGE BALANCE</small>
            <strong>{formatCredits(game.balance)}</strong>
          </span>
          <button type="button" onClick={refill}>+500</button>
        </div>
      </header>

      <section className="headline">
        <div>
          <p>ARCHERY / INFERENCE / PAYOUTS</p>
          <h1>TEN ARROWS.<br /><em>ONE SECRET.</em></h1>
        </div>
        <p className="intro">
          The bullseye is a decoy. Somewhere on the board is one exact, high-return
          point. Each payout is a noisy clue to its direction and distance.
        </p>
      </section>

      <section className="range-layout" id="range">
        <aside className="brief-panel">
          <div className="round-id">
            <span>ROUND</span>
            <strong>{String(round.id).padStart(2, "0")}</strong>
          </div>

          <div className="mission">
            <span className="section-label">YOUR READ</span>
            <h2>FIND THE HEAT BEFORE THE QUIVER RUNS DRY.</h2>
            <ol>
              <li><b>01</b><span>Click the target to fire.</span></li>
              <li><b>02</b><span>Use payouts as evidence.</span></li>
              <li><b>03</b><span>Exploit your warmest area.</span></li>
            </ol>
          </div>

          <div className="hidden-parameters">
            <span className="section-label">ROUND PARAMETERS</span>
            <p><span>BOARD AVG. RTP</span><b>99.00%</b></p>
            <p><span>EXACT POINT X / Y</span><b>{round.finished ? `${(round.hotspot.x * 100).toFixed(1)} / ${(round.hotspot.y * 100).toFixed(1)}` : "██.█ / ██.█"}</b></p>
            <p><span>PEAK MEAN RTP</span><b>{round.finished ? `${round.hotspot.peakRtp.toFixed(2)}×` : "█.██×"}</b></p>
            <p><span>HOTSPOT STD. DEV.</span><b>{round.finished ? `${hotspotStdDev.toFixed(2)}×` : "█.██×"}</b></p>
            <p><span>HOTSPOT VARIANCE</span><b>{round.finished ? `${hotspotVariance.toFixed(2)}×²` : "█.██×²"}</b></p>
          </div>

          <button type="button" className="rules-button" onClick={() => setShowRules(true)}>
            HOW THE MATH WORKS <span>↗</span>
          </button>
        </aside>

        <section className="target-stage">
          <div className="stage-topline">
            <span>{round.finished ? "EXACT POINT REVEALED" : "LIVE TARGET · CLICK TO FIRE"}</span>
            <strong>{ARROW_STAKE} CREDITS / ARROW</strong>
          </div>

          <div className="target-wrap">
            <button
              type="button"
              className={`target-board ${round.finished ? "is-revealed" : ""}`}
              aria-label="Archery target. Use pointer to aim and fire, or arrow keys to move the aim point and Enter to fire."
              onPointerMove={handlePointerMove}
              onPointerDown={handlePointerDown}
              onKeyDown={handleTargetKey}
              disabled={round.finished || game.balance < ARROW_STAKE}
            >
              <span className="ring-groove groove-one" />
              <span className="ring-groove groove-two" />
              <span className="ring-groove groove-three" />

              {round.finished && (
                <span
                  className="hotspot-point"
                  style={{
                    left: `${round.hotspot.x * 100}%`,
                    top: `${round.hotspot.y * 100}%`,
                  }}
                ><i /><b>EXACT HOTSPOT</b></span>
              )}

              {round.shots.map((shot) => (
                <span
                  className={`arrow-mark ${multiplierClass(shot.multiplier)} ${closestShot?.id === shot.id && round.finished ? "closest" : ""}`}
                  key={shot.id}
                  style={{ left: `${shot.x * 100}%`, top: `${shot.y * 100}%`, "--angle": `${18 + shot.number * 19}deg` } as CSSProperties}
                >
                  <i />
                  <b>{shot.number}</b>
                  <em>{shot.multiplier.toFixed(2)}×</em>
                </span>
              ))}

              {!round.finished && (
                <span className="aim-reticle" style={{ left: `${aim.x * 100}%`, top: `${aim.y * 100}%` }}>
                  <i />
                </span>
              )}
            </button>

            <span className="target-caption caption-left">NOT TO SCALE</span>
            <span className="target-caption caption-right">RANGE 07</span>
          </div>

          <div className="quiver-row" aria-label={`${arrowsLeft} arrows remaining`}>
            <div>
              <span className="section-label">QUIVER</span>
              <strong>{arrowsLeft} LEFT</strong>
            </div>
            <div className="arrow-slots">
              {Array.from({ length: QUIVER_SIZE }, (_, index) => (
                <span className={index < round.shots.length ? "spent" : "ready"} key={index}>➶</span>
              ))}
            </div>
          </div>

          <div className="notice" aria-live="polite">
            <span className="pulse" />
            <p>{notice}</p>
            {bestShot && <strong>BEST CLUE {bestShot.multiplier.toFixed(2)}×</strong>}
          </div>
        </section>

        <aside className="ledger-panel">
          <div className="ledger-title">
            <span>SHOT LEDGER</span>
            <button
              type="button"
              onClick={() => setGame({ ...game, sound: !game.sound })}
              aria-label={game.sound ? "Mute sound" : "Enable sound"}
            >
              {game.sound ? "SOUND ON" : "SOUND OFF"}
            </button>
          </div>

          <div className="round-return">
            <span>ROUND NET</span>
            <strong className={roundNet >= 0 ? "positive" : "negative"}>
              {roundNet >= 0 ? "+" : ""}{formatCredits(roundNet)}
            </strong>
            <small>demo credits</small>
          </div>

          <div className="shot-list">
            {round.shots.length === 0 ? (
              <div className="empty-ledger">
                <span>➶</span>
                <p>Your ten observations<br />will appear here.</p>
              </div>
            ) : (
              round.shots.map((shot) => (
                <div className="shot-row" key={shot.id}>
                  <span className={`shot-number ${multiplierClass(shot.multiplier)}`}>{shot.number}</span>
                  <div>
                    <strong>{shot.multiplier.toFixed(2)}× PAID</strong>
                    <small>{round.finished ? `${shot.meanRtp.toFixed(2)}× local mean` : shot.multiplier >= 1 ? "warm signal" : "cold signal"}</small>
                  </div>
                  <b className={shot.net >= 0 ? "positive" : "negative"}>{shot.net >= 0 ? "+" : ""}{shot.net}</b>
                </div>
              ))
            )}
          </div>

          {round.finished ? (
            <div className="reveal-card">
              <span>POINT REVEALED · {qualityLabel(round.hotspot.peakRtp)} / {varianceLabel(round.hotspot.payoutNoise)} VARIANCE</span>
              <h3>{closestShot ? `ARROW ${closestShot.number} WAS CLOSEST.` : "FIELD REVEALED."}</h3>
              <p>
                It landed {closestShot ? (closestShot.distance * 200).toFixed(1) : "0"}% of a target radius from the exact point.
              </p>
              <div className="reveal-stats">
                <div><small>HOTSPOT QUALITY</small><strong>{round.hotspot.peakRtp.toFixed(2)}×</strong><em>{qualityLabel(round.hotspot.peakRtp)} PEAK MEAN</em></div>
                <div><small>BOARD AVG. RTP</small><strong>99.0%</strong><em>AREA-NORMALIZED</em></div>
                <div><small>PAYOUT STD. DEV.</small><strong>±{hotspotStdDev.toFixed(2)}×</strong><em>{Math.round(round.hotspot.payoutNoise * 100)}% OF MEAN</em></div>
                <div><small>PAYOUT VARIANCE</small><strong>{hotspotVariance.toFixed(2)}×²</strong><em>{varianceLabel(round.hotspot.payoutNoise)} VOLATILITY</em></div>
                <div><small>OFF-HOTSPOT FLOOR</small><strong>{round.hotspot.baseRtp.toFixed(2)}×</strong><em>SOLVED THIS ROUND</em></div>
                <div><small>REALIZED RTP</small><strong>{(realizedRtp * 100).toFixed(0)}%</strong><em>THIS QUIVER</em></div>
              </div>
              <button type="button" onClick={startNextRound}>STRING A NEW QUIVER →</button>
            </div>
          ) : (
            <div className="live-tip">
              <span>RANGE NOTE</span>
              <p>A single hot payout may be noise. Cluster evidence before you commit the remaining arrows.</p>
            </div>
          )}

          <details className="lifetime">
            <summary>LIFETIME / THIS DEVICE <span>+</span></summary>
            <div><small>Rounds</small><strong>{game.stats.rounds}</strong></div>
            <div><small>Arrows fired</small><strong>{game.stats.arrows}</strong></div>
            <div><small>Best payout</small><strong>{game.stats.bestMultiplier.toFixed(2)}×</strong></div>
            <div><small>Net credits</small><strong className={lifetimeNet >= 0 ? "positive" : "negative"}>{lifetimeNet >= 0 ? "+" : ""}{formatCredits(lifetimeNet)}</strong></div>
          </details>

          <button type="button" className="reset-button" onClick={resetDemo}>RESET LOCAL DEMO</button>
        </aside>
      </section>

      <footer>
        <p>PLAY-MONEY PROTOTYPE · NO DEPOSITS · NO WITHDRAWALS · NO CASH VALUE</p>
        <p>EVERY BOARD IS AREA-NORMALIZED TO 99% RTP · PLAYER CHOICES CAN RUN ABOVE OR BELOW IT</p>
      </footer>

      {showRules && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="math-title">
          <div className="math-modal">
            <button type="button" className="modal-close" onClick={() => setShowRules(false)} aria-label="Close">×</button>
            <span className="modal-kicker">THE HIDDEN FIELD</span>
            <h2 id="math-title">CLOSER MEANS HOTTER.<br />NOT CERTAIN.</h2>
            <p>Every round secretly samples one exact point <i>c</i>, a peak mean RTP <i>P</i>, and payout-noise standard deviation <i>v</i>. The off-hotspot floor <i>B</i> is then solved so a uniformly random point on the board averages 0.99×.</p>
            <div className="formula">
              <small>EXPECTED PAYOUT AT DISTANCE d</small>
              <strong>μ(d) = B + (P − B)e<sup>−d² / 2(0.14)²</sup></strong>
            </div>
            <div className="parameter-grid">
              <div><span>PEAK P</span><strong>2.40–4.40×</strong><p>The secret center is deliberately rich.</p></div>
              <div><span>EXACT POINT c</span><strong>ONE LOCATION</strong><p>The reveal marks a coordinate, not an area.</p></div>
              <div><span>NOISE SD v</span><strong>16–55%</strong><p>Randomized independently each round.</p></div>
              <div><span>BOARD AVERAGE</span><strong>0.99×</strong><p>The spatial average is normalized every round.</p></div>
            </div>
            <p className="math-note">If K is the board-average Gaussian weight, B = (0.99 − PK) / (1 − K). At the hotspot, payout SD = Pv and variance = (Pv)². The noise multiplier has mean 1, so E[payout | location] = μ(d).</p>
            <button type="button" className="close-primary" onClick={() => setShowRules(false)}>BACK TO THE RANGE</button>
          </div>
        </div>
      )}
    </main>
  );
}
