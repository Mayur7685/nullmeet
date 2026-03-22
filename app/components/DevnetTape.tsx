"use client";

export function DevnetTape() {
  const items = Array(20).fill("USE DEVNET");

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 overflow-hidden h-7 flex items-center">
      <div className="devnet-tape whitespace-nowrap flex">
        {items.map((text, i) => (
          <span
            key={i}
            className="text-black font-bold text-xs tracking-widest mx-6"
          >
            {text}
          </span>
        ))}
        {items.map((text, i) => (
          <span
            key={`dup-${i}`}
            className="text-black font-bold text-xs tracking-widest mx-6"
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
