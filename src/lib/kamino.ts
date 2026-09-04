import "server-only";

/**
 * Kamino Lending (Main Market USDC) step helpers for Intents Connect.
 *
 * Yes — Near/Aurora Intents can deposit into Solana DeFi. Use Intents Connect
 * `quote_with_steps` to bridge from EVM and supply to Kamino in one execution:
 * https://docs.intents.aurora.dev/intents-connect/developer-guides/solana/kamino-stake-scenario.md
 *
 * Confidential Intents currently hide origin + route on the Swap API.
 * Confidential DeFi actions are rolling out across the suite.
 */

export const KAMINO = {
  program: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
  lendingMarket: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
  lendingMarketAuthority: "9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo",
  usdcReserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  reserveLiquiditySupply: "Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6",
  collateralMint: "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D",
  scopeOracle: "3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH",
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  instructionsSysvar: "Sysvar1nstructions1111111111111111111111111",
  refreshDiscriminator: "02da8aeb4fc91966",
  depositDiscriminator: "a9c91e7e06cd6644",
} as const;

export type SolanaStep = {
  metadata?: { name: string; description: string };
  programId: string;
  discriminator: string;
  args: Array<{ name: string; type: string; value: string }>;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
};

/**
 * Build refresh + deposit_reserve_liquidity steps for a bridge-in Kamino supply.
 * liquidityAmount should be "{MIN_AMOUNT_OUT}" for quote_with_steps, or a u64
 * string for steps-only.
 */
export function buildKaminoUsdcDepositSteps(input: {
  intermediaryUsdcAta: string;
  intermediaryCollateralAta: string;
  liquidityAmount: string;
}): SolanaStep[] {
  const refresh: SolanaStep = {
    metadata: {
      name: "Refresh reserve",
      description: "Refresh the Kamino USDC reserve price",
    },
    programId: KAMINO.program,
    discriminator: KAMINO.refreshDiscriminator,
    args: [],
    accounts: [
      { pubkey: KAMINO.usdcReserve, isSigner: false, isWritable: true },
      { pubkey: KAMINO.lendingMarket, isSigner: false, isWritable: false },
      { pubkey: KAMINO.program, isSigner: false, isWritable: false },
      { pubkey: KAMINO.program, isSigner: false, isWritable: false },
      { pubkey: KAMINO.program, isSigner: false, isWritable: false },
      { pubkey: KAMINO.scopeOracle, isSigner: false, isWritable: false },
    ],
  };

  const deposit: SolanaStep = {
    metadata: {
      name: "Deposit into Kamino",
      description: "Supply USDC, receive cUSDC",
    },
    programId: KAMINO.program,
    discriminator: KAMINO.depositDiscriminator,
    args: [
      {
        name: "liquidity_amount",
        type: "u64",
        value: input.liquidityAmount,
      },
    ],
    accounts: [
      { pubkey: "{INTERMEDIARY}", isSigner: true, isWritable: false },
      { pubkey: KAMINO.usdcReserve, isSigner: false, isWritable: true },
      { pubkey: KAMINO.lendingMarket, isSigner: false, isWritable: false },
      {
        pubkey: KAMINO.lendingMarketAuthority,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: KAMINO.usdcMint, isSigner: false, isWritable: false },
      {
        pubkey: KAMINO.reserveLiquiditySupply,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: KAMINO.collateralMint, isSigner: false, isWritable: true },
      {
        pubkey: input.intermediaryUsdcAta,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: input.intermediaryCollateralAta,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: KAMINO.tokenProgram, isSigner: false, isWritable: false },
      { pubkey: KAMINO.tokenProgram, isSigner: false, isWritable: false },
      {
        pubkey: KAMINO.instructionsSysvar,
        isSigner: false,
        isWritable: false,
      },
    ],
  };

  return [refresh, deposit];
}

export const DEFI_NOTES = {
  supported: true,
  product: "Intents Connect",
  example: "Kamino Lending USDC supply",
  docs: "https://docs.intents.aurora.dev/intents-connect/developer-guides/solana/kamino-stake-scenario.md",
  summary:
    "Bridge USDC (or other assets) from an EVM chain and deposit into Kamino in one signed Connect execution (quote_with_steps). The Solana action runs from an MPC intermediary derived from the origin wallet — not your hidden settlement wallet unless you transfer afterwards.",
  confidentiality:
    "Swap API confidential mode hides origin + route. Destination settlement stays public. Confidential DeFi actions are rolling out.",
} as const;
