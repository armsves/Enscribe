import type { Address, Chain } from "viem";
import { arbitrum, base, mainnet, optimism } from "viem/chains";

export const PAY_CHAINS: Record<
  string,
  {
    chainId: number;
    chain: Chain;
    label: string;
    explorerTx: (hash: string) => string;
  }
> = {
  eth: {
    chainId: 1,
    chain: mainnet,
    label: "Ethereum",
    explorerTx: (hash) => `https://etherscan.io/tx/${hash}`,
  },
  arb: {
    chainId: 42161,
    chain: arbitrum,
    label: "Arbitrum",
    explorerTx: (hash) => `https://arbiscan.io/tx/${hash}`,
  },
  op: {
    chainId: 10,
    chain: optimism,
    label: "Optimism",
    explorerTx: (hash) => `https://optimistic.etherscan.io/tx/${hash}`,
  },
  base: {
    chainId: 8453,
    chain: base,
    label: "Base",
    explorerTx: (hash) => `https://basescan.org/tx/${hash}`,
  },
};

export type PayToken = {
  symbol: string;
  decimals: number;
  blockchain: string;
  contractAddress: Address | null;
  chainId: number;
};

export const erc20Abi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
