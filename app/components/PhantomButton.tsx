"use client";

import { useWallet } from "@solana/wallet-adapter-react";

export function PhantomButton() {
  const { connected, connecting, publicKey, select, disconnect, wallets } =
    useWallet();

  const handleConnect = () => {
    const phantom = wallets.find(
      (w) => w.adapter.name === "Phantom"
    );
    if (phantom) {
      select(phantom.adapter.name);
    } else {
      window.open("https://phantom.app/", "_blank");
    }
  };

  if (connected && publicKey) {
    const addr = publicKey.toBase58();
    const short = `${addr.slice(0, 4)}..${addr.slice(-4)}`;
    return (
      <button
        onClick={disconnect}
        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors"
      >
        {short}
      </button>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={connecting}
      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 text-white text-sm font-medium rounded-lg transition-colors"
    >
      {connecting ? "Connecting..." : "Connect Phantom"}
    </button>
  );
}
