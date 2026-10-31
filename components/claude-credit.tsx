import Image from "next/image";

export function ClaudeCredit() {
  return (
    <div className="claude-credit">
      <span>Powered by</span>
      <Image src="/claude-symbol.svg" alt="" width={16} height={16} unoptimized />
      <span className="claude-credit-name">Claude</span>
    </div>
  );
}
