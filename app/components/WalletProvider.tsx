"use client";

import { useMemo, useState, useEffect } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC || clusterApiUrl("devnet");

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{mounted ? children : null}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
