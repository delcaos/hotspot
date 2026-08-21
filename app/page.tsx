"use client";

import { useEffect, useMemo, useState } from "react";

const BET = 10;
const RUN_LENGTH = 40;
const STORAGE_KEY = "fourtune-vaults-state-v1";
const OUTCOMES = [0, 1, 3, 10] as const;

type Outcome = (typeof OUTCOMES)[number];
type VaultKind = "ember" | "fountain" | "comet" | "stone";

type VaultDefinition = {
  id: VaultKind;
  name: string;
  subtitle: string;
  symbol: string;
  rtp: number;
  probabilities: Record<Outcome, number>;
};

type Play = {
  id: number;
  turn: number;
  vault: number;
  outcome: Outcome;
  net: number;
};

type Scan = {
  id: number;
  vault: number;
  clue: VaultKind;
};

type GameState = {
  version: 1;
  balance: number;
  insight: number;
  run: number;
  turn: number;
  assignments: VaultKind[];
  history: Play[];
  scans: Scan[];
  scanTokens: number;
  revealed: boolean;
  guessVault: number | null;
  sound: boolean;
  stats: {
    runs: number;
    correctGuesses: number;
    wagered: number;
    returned: number;
    biggestWin: number;
    refills: number;
  };
};

const VAULTS: VaultDefinition[] = [
  {
    id: "ember",
    name: "Ember",
    subtitle: "Best long-run value",
    symbol: "✦",
    rtp: 0.995,
    probabilities: { 0: 0.505, 1: 0.315, 3: 0.16, 10: 0.02 },
  },
  {
    id: "fountain",
    name: "Fountain",
    subtitle: "Frequent, modest returns",
    symbol: "≈",
    rtp: 0.98,
    probabilities: { 0: 0.225, 1: 0.69, 3: 0.08, 10: 0.005 },
  },
  {
    id: "comet",
    name: "Comet",
    subtitle: "Rare, volatile bursts",
    symbol: "☄",
    rtp: 0.965,
    probabilities: { 0: 0.705, 1: 0.17, 3: 0.065, 10: 0.06 },
  },
  {
    id: "stone",
    name: "Stone",
    subtitle: "Steady but stubborn",
    symbol: "◆",
    rtp: 0.95,
    probabilities: { 0: 0.42, 1: 0.43, 3: 0.14, 10: 0.01 },
  },
];

const VAULT_IDS = VAULTS.map((vault) => vault.id);
const LETTERS = ["A", "B", "C", "D"];
const vaultById = Object.fromEntries(
  VAULTS.map((vault) => [vault.id, vault]),
) as Record<VaultKind, VaultDefinition>;

function randomUnit() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] / 4294967296;
  }
  return Math.random();
}

function shuffledVaults() {
  const ids = [...VAULT_IDS];
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(randomUnit() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

function freshState(previous?: GameState): GameState {
  return {
    version: 1,
    balance: previous?.balance ?? 1000,
    insight: previous?.insight ?? 0,
    run: previous ? previous.run + 1 : 1,
    turn: 0,
    assignments: shuffledVaults(),
    history: [],
    scans: [],
    scanTokens: 1,
    revealed: false,
    guessVault: null,
    sound: previous?.sound ?? true,
    stats: previous?.stats ?? {
      runs: 0,
      correctGuesses: 0,
      wagered: 0,
      returned: 0,
      biggestWin: 0,
      refills: 0,
    },
  };
}

function permutations<T>(items: T[]): T[][] {
  if (items.length === 0) return [[]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  );
}

const POSSIBLE_LINEUPS = permutations(VAULT_IDS);

function posterior(state: GameState) {
  const logWeights = POSSIBLE_LINEUPS.map((lineup) => {
    let score = 0;
    for (const play of state.history) {
      score += Math.log(
        Math.max(
          vaultById[lineup[play.vault]].probabilities[play.outcome],
          Number.EPSILON,
        ),
      );
    }
    for (const scan of state.scans) {
      score += Math.log(
        lineup[scan.vault] === scan.clue ? 0.72 : 0.28 / 3,
      );
    }
    return score;
  });

  const max = Math.max(...logWeights);
  const raw = logWeights.map((weight) => Math.exp(weight - max));
  const total = raw.reduce((sum, weight) => sum + weight, 0);
  const weights = raw.map((weight) => weight / total);

  return LETTERS.map((_, vaultIndex) => {
    let bestChance = 0;
    let expectedRtp = 0;
    for (let i = 0; i < POSSIBLE_LINEUPS.length; i += 1) {
      const kind = POSSIBLE_LINEUPS[i][vaultIndex];
      expectedRtp += weights[i] * vaultById[kind].rtp;
      if (kind === "ember") bestChance += weights[i];
    }
    return { bestChance, expectedRtp };
  });
}

function sampleOutcome(kind: VaultKind): Outcome {
  let cursor = randomUnit();
  for (const outcome of OUTCOMES) {
    cursor -= vaultById[kind].probabilities[outcome];
    if (cursor <= 0) return outcome;
  }
  return 10;
}

function sampleScanClue(kind: VaultKind): VaultKind {
  if (randomUnit() < 0.72) return kind;
  const alternatives = VAULT_IDS.filter((id) => id !== kind);
  return alternatives[Math.floor(randomUnit() * alternatives.length)];
}

function formatCredits(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function playTone(enabled: boolean, outcome: Outcome | "scan" | "guess") {
  if (!enabled || typeof window === "undefined") return;
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const frequency =
    outcome === "scan"
      ? 520
      : outcome === "guess"
        ? 760
        : outcome === 10
          ? 880
          : outcome === 3
            ? 640
            : outcome === 1
              ? 360
              : 150;
  oscillator.frequency.setValueAtTime(frequency, context.currentTime);
  oscillator.type = outcome === 0 ? "sawtooth" : "sine";
  gain.gain.setValueAtTime(0.05, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    context.currentTime + (outcome === 10 ? 0.55 : 0.22),
  );
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + (outcome === 10 ? 0.55 : 0.22));
  oscillator.addEventListener("ended", () => void context.close());
}

export default function Home() {
  const [game, setGame] = useState<GameState | null>(null);
  const [notice, setNotice] = useState("Choose a vault to begin the read.");
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as GameState;
        if (parsed.version === 1 && Array.isArray(parsed.assignments)) {
          setGame(parsed);
          return;
        }
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setGame(freshState());
  }, []);

  useEffect(() => {
    if (game) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  }, [game]);

  const hunches = useMemo(() => (game ? posterior(game) : []), [game]);
  const leader = hunches.length
    ? hunches.reduce(
        (best, hunch, index) =>
          hunch.expectedRtp > hunches[best].expectedRtp ? index : best,
        0,
      )
    : 0;

  if (!game) {
    return (
      <main className="loading-screen">
        <div className="loading-mark">FV</div>
        <p>Turning the tumblers…</p>
      </main>
    );
  }

  const lastPlay = game.history.at(-1);
  const progress = (game.turn / RUN_LENGTH) * 100;
  const completed = game.turn >= RUN_LENGTH;
  const runNet = game.history.reduce((sum, play) => sum + play.net, 0);

  function openVault(vaultIndex: number) {
    if (
      !game ||
      completed ||
      game.revealed ||
      game.balance < BET
    )
      return;

    const outcome = sampleOutcome(game.assignments[vaultIndex]);
    const returned = BET * outcome;
    const nextTurn = game.turn + 1;
    const net = returned - BET;
    const newToken = nextTurn % 8 === 0 ? 1 : 0;

    setGame({
      ...game,
      balance: game.balance + net,
      turn: nextTurn,
      scanTokens: game.scanTokens + newToken,
      history: [
        ...game.history,
        {
          id: Date.now(),
          turn: nextTurn,
          vault: vaultIndex,
          outcome,
          net,
        },
      ],
      stats: {
        ...game.stats,
        wagered: game.stats.wagered + BET,
        returned: game.stats.returned + returned,
        biggestWin: Math.max(game.stats.biggestWin, returned),
      },
    });

    if (outcome === 10) setNotice(`Vault ${LETTERS[vaultIndex]} erupts — 10×!`);
    else if (outcome === 3) setNotice(`Vault ${LETTERS[vaultIndex]} flashes — 3× returned.`);
    else if (outcome === 1) setNotice(`Vault ${LETTERS[vaultIndex]} returns your stake.`);
    else setNotice(`Vault ${LETTERS[vaultIndex]} stays quiet. What did that tell you?`);
    if (newToken) setNotice("A new scan token is ready. Spend it wisely.");
    playTone(game.sound, outcome);
  }

  function scanVault(vaultIndex: number) {
    if (!game || game.scanTokens < 1 || game.revealed) return;
    const clue = sampleScanClue(game.assignments[vaultIndex]);
    setGame({
      ...game,
      scanTokens: game.scanTokens - 1,
      scans: [
        ...game.scans,
        { id: Date.now(), vault: vaultIndex, clue },
      ],
    });
    setNotice(
      `The scanner reads “${vaultById[clue].name}” for Vault ${LETTERS[vaultIndex]}. Clues are 72% reliable.`,
    );
    playTone(game.sound, "scan");
  }

  function makeFinalCall(vaultIndex: number) {
    if (!game || !completed || game.revealed) return;
    const correct = game.assignments[vaultIndex] === "ember";
    const award = correct ? 250 : 50;
    setGame({
      ...game,
      insight: game.insight + award,
      revealed: true,
      guessVault: vaultIndex,
      stats: {
        ...game.stats,
        runs: game.stats.runs + 1,
        correctGuesses: game.stats.correctGuesses + (correct ? 1 : 0),
      },
    });
    setNotice(
      correct
        ? `Perfect read. Vault ${LETTERS[vaultIndex]} held Ember. +250 insight.`
        : `Not this time. The house grants +50 insight for finishing the read.`,
    );
    playTone(game.sound, "guess");
  }

  function refillWallet() {
    if (!game) return;
    setGame({
      ...game,
      balance: game.balance + 1000,
      stats: { ...game.stats, refills: game.stats.refills + 1 },
    });
    setNotice("1,000 free demo credits added. They have no cash value.");
  }

  function resetDemo() {
    if (!window.confirm("Reset the fake balance, insight, and all local stats?"))
      return;
    window.localStorage.removeItem(STORAGE_KEY);
    setGame(freshState());
    setNotice("Fresh ledger. Four new secrets are behind the doors.");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#game" aria-label="Fourtune Vaults home">
          <span className="brand-mark">FV</span>
          <span>
            <strong>FOURTUNE</strong>
            <small>VAULTS</small>
          </span>
        </a>

        <div className="demo-ribbon">DEMO CREDITS · NO CASH VALUE</div>

        <div className="wallet" aria-label={`${game.balance} demo credits`}>
          <span className="coin">¢</span>
          <span>
            <small>LOCAL BALANCE</small>
            <strong>{formatCredits(game.balance)}</strong>
          </span>
          <button type="button" onClick={refillWallet} title="Add 1,000 fake credits">
            + REFILL
          </button>
        </div>
      </header>

      <section className="hero" id="game">
        <div>
          <p className="eyebrow">SHIFT {String(game.run).padStart(2, "0")} · FOUR DOORS, ONE EMBER</p>
          <h1>READ THE ROOMS.<br /><em>FIND THE RICH VAULT.</em></h1>
        </div>
        <p className="hero-copy">
          Every opening pays—or teaches. Test the vaults, read their patterns,
          then press your best hunch before the shift ends.
        </p>
      </section>

      <div className="progress-rail" aria-label={`${game.turn} of ${RUN_LENGTH} turns complete`}>
        <span style={{ width: `${progress}%` }} />
      </div>

      <section className="game-layout">
        <aside className="left-panel">
          <div className="turn-counter">
            <span className="big-number">{String(game.turn).padStart(2, "0")}</span>
            <span>OF {RUN_LENGTH}<br />OPENINGS</span>
          </div>

          <div className="run-ledger">
            <p>THIS SHIFT</p>
            <strong className={runNet >= 0 ? "positive" : "negative"}>
              {runNet >= 0 ? "+" : ""}{formatCredits(runNet)}
            </strong>
            <small>demo credits net</small>
          </div>

          <div className="insight-block">
            <span>INSIGHT</span>
            <strong>{formatCredits(game.insight)}</strong>
            <p>Prestige only. Earn it by finishing shifts and finding Ember.</p>
          </div>

          <div className="scan-block">
            <div className="scan-heading">
              <span>SCANS READY</span>
              <strong>{game.scanTokens}</strong>
            </div>
            <p>Free clue, 72% accurate. New token every eight paid openings.</p>
          </div>

          <button className="text-button" type="button" onClick={() => setShowGuide(true)}>
            HOW THE READ WORKS <span>↗</span>
          </button>
        </aside>

        <section className="vault-stage" aria-label="Choose a vault">
          <div className="stage-header">
            <div>
              <span className="label">CURRENT READ</span>
              <strong>{game.revealed ? "TEMPERAMENTS REVEALED" : `VAULT ${LETTERS[leader]} LEADS`}</strong>
            </div>
            <div className="stake-chip">
              <span>FIXED STAKE</span>
              <strong>{BET} CREDITS</strong>
            </div>
          </div>

          <div className="vault-grid">
            {LETTERS.map((letter, index) => {
              const plays = game.history.filter((play) => play.vault === index);
              const latest = [...plays].at(-1);
              const latestScan = game.scans.filter((scan) => scan.vault === index).at(-1);
              const hunch = hunches[index];
              const kind = vaultById[game.assignments[index]];
              const isLeader = index === leader && !game.revealed;
              const isRecent = lastPlay?.vault === index;
              const guessed = game.guessVault === index;

              return (
                <article
                  className={`vault-card ${isLeader ? "leader" : ""} ${isRecent ? "recent" : ""} ${game.revealed ? `revealed ${kind.id}` : ""}`}
                  key={letter}
                >
                  <div className="vault-meta">
                    <span>VAULT {letter}</span>
                    <span>{plays.length} READ{plays.length === 1 ? "" : "S"}</span>
                  </div>

                  <div className="door-wrap" aria-hidden="true">
                    <div className="vault-door">
                      <span className="door-tick tick-one" />
                      <span className="door-tick tick-two" />
                      <span className="door-tick tick-three" />
                      <span className="door-letter">{game.revealed ? kind.symbol : letter}</span>
                      <span className="door-handle" />
                    </div>
                    {latest && (
                      <span className={`last-result outcome-${latest.outcome}`}>
                        {latest.outcome === 0 ? "MISS" : `${latest.outcome}×`}
                      </span>
                    )}
                  </div>

                  {game.revealed ? (
                    <div className="reveal-copy">
                      <span>{guessed ? "YOUR CALL" : "TEMPERAMENT"}</span>
                      <strong>{kind.name}</strong>
                      <small>{(kind.rtp * 100).toFixed(1)}% RTP · {kind.subtitle}</small>
                    </div>
                  ) : (
                    <div className="hunch">
                      <div>
                        <span>EMBER HUNCH</span>
                        <strong>{Math.round(hunch.bestChance * 100)}%</strong>
                      </div>
                      <div className="hunch-bar"><span style={{ width: `${Math.max(3, hunch.bestChance * 100)}%` }} /></div>
                      <small>
                        {latestScan ? `LAST SCAN: ${vaultById[latestScan.clue].name.toUpperCase()} · ` : ""}
                        Est. return {(hunch.expectedRtp * 100).toFixed(2)}%
                      </small>
                    </div>
                  )}

                  <div className="vault-actions">
                    <button
                      className="open-button"
                      type="button"
                      onClick={() => openVault(index)}
                      disabled={completed || game.revealed || game.balance < BET}
                      aria-label={`Open Vault ${letter} for ${BET} demo credits`}
                    >
                      OPEN <span>−{BET}</span>
                    </button>
                    <button
                      className="scan-button"
                      type="button"
                      onClick={() => scanVault(index)}
                      disabled={game.scanTokens < 1 || game.revealed}
                      aria-label={`Scan Vault ${letter}`}
                    >
                      ◉ SCAN
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="notice" aria-live="polite">
            <span className="signal-dot" />
            <p>{notice}</p>
            <span className="notice-count">{RUN_LENGTH - game.turn} LEFT</span>
          </div>
        </section>

        <aside className="right-panel">
          <div className="panel-heading">
            <span>READ LOG</span>
            <button
              type="button"
              className="sound-button"
              onClick={() => setGame({ ...game, sound: !game.sound })}
              aria-label={game.sound ? "Mute sound" : "Enable sound"}
            >
              {game.sound ? "SOUND ON" : "SOUND OFF"}
            </button>
          </div>

          <div className="history-list">
            {game.history.length === 0 ? (
              <div className="empty-log">
                <span>∅</span>
                <p>No reads yet.<br />The vaults are waiting.</p>
              </div>
            ) : (
              [...game.history].reverse().slice(0, 9).map((play) => (
                <div className="history-row" key={play.id}>
                  <span>{String(play.turn).padStart(2, "0")}</span>
                  <strong>VAULT {LETTERS[play.vault]}</strong>
                  <b className={play.net > 0 ? "win" : play.net === 0 ? "push" : "loss"}>
                    {play.outcome === 0 ? "MISS" : `${play.outcome}×`}
                  </b>
                  <small>{play.net > 0 ? "+" : ""}{play.net}</small>
                </div>
              ))
            )}
          </div>

          <div className="lifetime-stats">
            <span>LIFETIME / THIS DEVICE</span>
            <div><small>Shifts read</small><strong>{game.stats.runs}</strong></div>
            <div><small>Embers found</small><strong>{game.stats.correctGuesses}</strong></div>
            <div><small>Biggest return</small><strong>{game.stats.biggestWin}</strong></div>
          </div>

          <details className="math-drawer">
            <summary>THE FOUR TEMPERAMENTS <span>+</span></summary>
            <div>
              {VAULTS.map((vault) => (
                <p key={vault.id}>
                  <b>{vault.symbol} {vault.name}</b>
                  <span>{(vault.rtp * 100).toFixed(1)}% RTP</span>
                </p>
              ))}
              <small>Random choice averages 97.25% RTP. Even perfect knowledge tops out at 99.5%.</small>
            </div>
          </details>

          <button type="button" className="reset-button" onClick={resetDemo}>
            RESET LOCAL DEMO
          </button>
        </aside>
      </section>

      <footer>
        <p>PLAY MONEY PROTOTYPE · RESULTS GENERATED AND STORED ON THIS DEVICE</p>
        <p>RTP IS THEORETICAL OVER MANY PLAYS · THIS DEMO CANNOT PAY OR ACCEPT MONEY</p>
      </footer>

      {completed && !game.revealed && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="final-title">
          <div className="final-call">
            <span className="modal-kicker">THE FINAL CALL</span>
            <h2 id="final-title">WHERE IS EMBER?</h2>
            <p>Forty reads are in the ledger. Name the richest vault to bank 250 insight.</p>
            <div className="final-options">
              {LETTERS.map((letter, index) => (
                <button type="button" key={letter} onClick={() => makeFinalCall(index)}>
                  <small>VAULT</small><strong>{letter}</strong>
                  <span>{Math.round(hunches[index].bestChance * 100)}% HUNCH</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {game.revealed && (
        <div className="result-strip" role="status">
          <div>
            <span>SHIFT {String(game.run).padStart(2, "0")} CLOSED</span>
            <strong>{game.assignments[game.guessVault ?? 0] === "ember" ? "EMBER FOUND" : "THE VAULTS WIN THIS READ"}</strong>
          </div>
          <p>Net {runNet >= 0 ? "+" : ""}{runNet} credits · {game.assignments.map((kind, index) => `${LETTERS[index]}: ${vaultById[kind].name}`).join("  /  ")}</p>
          <button type="button" onClick={() => { setGame(freshState(game)); setNotice("New shift. New secrets. Trust the evidence."); }}>
            START NEXT SHIFT →
          </button>
        </div>
      )}

      {showGuide && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="guide-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowGuide(false); }}>
          <div className="guide-modal">
            <button className="modal-close" type="button" onClick={() => setShowGuide(false)} aria-label="Close guide">×</button>
            <span className="modal-kicker">FIELD MANUAL / 01</span>
            <h2 id="guide-title">EVERY OPENING IS EVIDENCE.</h2>
            <ol>
              <li><b>Explore.</b><span>Open different vaults to learn their payout personalities.</span></li>
              <li><b>Read.</b><span>The Ember hunch uses every result and scan to update the odds.</span></li>
              <li><b>Exploit.</b><span>Favor your leading vault—but leave room for a surprising clue.</span></li>
              <li><b>Call it.</b><span>After 40 openings, identify Ember for 250 prestige insight.</span></li>
            </ol>
            <div className="guide-note">
              <strong>GENTLE BY DESIGN</strong>
              <p>The weakest temperament returns 95% in theory; the best returns 99.5%. Strategy matters, but a bad read is not brutally expensive.</p>
            </div>
            <button className="primary-guide-button" type="button" onClick={() => setShowGuide(false)}>BACK TO THE VAULTS</button>
          </div>
        </div>
      )}
    </main>
  );
}
