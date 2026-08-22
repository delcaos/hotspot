# Hotspot

A fully client-side, play-money archery deduction game. Every round hides one
exact hotspot among 37 target pins. Arrows are unlimited: misses always return
less than 1×, reveal a distance band, and reduce the set of possible points.
The round ends only when the hotspot is hit.

## Local play

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

All fake balances, round progress, and stats live in browser `localStorage`
under `hotspot-archery-state-v4`. There are no accounts, deposits, withdrawals,
or cash-value rewards.

## 99% good-play RTP

Let `S` be the hotspot points still consistent with all previous readings,
`N = |S|`, and `m(a,h) < 1` be the miss multiplier produced by aiming at point
`a` when the hotspot is `h`. The hit reward is solved on every good shot as:

```text
J(a) = 0.99N - Σ[h ∈ S, h ≠ a] m(a,h)
```

Because the secret is uniform over the remaining points, a shot at any point
that remains possible has:

```text
E[multiplier | good shot]
  = (J(a) + Σm(a,h)) / N
  = 0.99
```

Every round randomizes its cold/cool/warm/near miss curve, keeping every miss
strictly below 1× while also randomizing the hotspot reward. A shot at a point
already ruled out pays 0.96× and provides no new evidence. Good play therefore
always has 99% theoretical RTP; skill reduces the number of wagers needed to
find the point and therefore the expected absolute loss.

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
