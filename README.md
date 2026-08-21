# Fourtune Vaults

A client-side, play-money multi-armed-bandit game. Four hidden vault
temperaments are shuffled at the beginning of every 40-opening shift. Players
balance exploration and exploitation, use noisy scans, and make a final call on
the highest-returning temperament.

## Local play

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

All balances, shift progress, stats, and preferences live in browser
`localStorage` under `fourtune-vaults-state-v1`. There are no accounts, server
records, deposits, withdrawals, or cash-value rewards.

## Game economy

- Fixed stake: 10 fake credits per opening
- Starting balance: 1,000 fake credits
- Random-play theoretical RTP: 97.25%
- Best temperament theoretical RTP: 99.5%
- Worst temperament theoretical RTP: 95.0%
- Free fake-balance refill: 1,000 credits

The four payout distributions and the Bayesian hunch calculation are defined in
`app/page.tsx`. This is an entertainment prototype, not audited gambling
software.

## Build

```bash
npm run build
```
