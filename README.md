# Hotspot

A fully client-side, play-money Bayesian archery game. Every round hides one
exact hotspot among 217 full-board target pins. Arrows are unlimited, occupied
pins cannot be shot twice, and every sub-1× miss payout is noisy spatial
evidence that updates a visible posterior probability field.

## Local play

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

All fake balances, round progress, and stats live in browser `localStorage`
under `hotspot-archery-state-v8`. There are no accounts, deposits, withdrawals,
or cash-value rewards.

## Bayesian signal model and 99% RTP

The hidden hotspot begins with a uniform prior over all pins. A miss returns one
of eight multipliers from `0.00×` to `0.95×`. Its likelihood depends smoothly on
distance through a randomized Gaussian field that blends cold and hot payout
distributions. After aiming at `a` and observing payout `y`, every unoccupied
pin is updated by Bayes' rule:

```text
p'(h) ∝ p(h) L(y | d(a,h))
```

The board renders this posterior directly through pin brightness and size. A
large payout strongly favors nearby pins, but signal noise keeps every result
probabilistic rather than revealing a hard distance bucket. Search quality can
be measured by the reduction in Shannon entropy.

For an open aim point `a`, let `p(a)` be its current hit probability and let
`μ(a,h)` be the expected miss payout when the hotspot is `h`. The live hit
reward is solved as:

```text
J(a) = [0.99 - Σ(h ≠ a) p(h) μ(a,h)] / p(a)
```

Therefore `p(a)J(a) + Σp(h)μ(a,h) = 0.99` for every open pin. Strategy does not
change the house edge on an individual wager; it changes how efficiently the
player extracts information and how many 1%-edge wagers are needed to find the
hotspot. Every arrow remains visible until the round ends.

This is an entertainment prototype, not audited gambling software.

## Build

```bash
npm run build
```

The GitHub Pages build is a static Vite bundle configured for the `/hotspot/`
project path:

```bash
npm run build:pages
```

Pushing `main` deploys that bundle to
`https://delcaos.github.io/hotspot/` through GitHub Actions.
