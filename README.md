# Hotspot

A fully client-side, play-money archery search game. Every round hides a
randomized high-return field somewhere on the target. The player gets ten
arrows; each payout is a noisy observation of the local expected return. The
field is revealed when the quiver is empty.

## Local play

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

All fake balances, round progress, and stats live in browser `localStorage`
under `hotspot-archery-state-v3`. There are no accounts, deposits, withdrawals,
or cash-value rewards.

## Hidden field

For distance `d` from the hidden center:

```text
meanRtp(d) = baseRtp + (peakRtp - baseRtp) exp(-d² / (2 × 0.14²))
```

Each round samples one exact point, `peakRtp` between 2.40× and 4.40×, and a
payout-noise standard deviation between 16% and 55%. Spatial falloff is fixed.
The game numerically averages the Gaussian weight over the circular target and
solves `baseRtp` so a uniformly random location has 99% theoretical RTP:

```text
baseRtp = (0.99 - peakRtp × averageKernelWeight) /
          (1 - averageKernelWeight)
```

Observed payout noise has mean one, so it does not change that theoretical
average. The reveal reports hotspot quality, board-average RTP, payout standard
deviation, payout variance, off-hotspot floor, and realized round RTP.

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
