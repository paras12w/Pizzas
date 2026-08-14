"use client";

interface PortfolioData {
  startingBalance: number;
  currentBalance: number;
  totalPnl: number;
  winRate: number;
  openCount: number;
  closedCount: number;
}

export default function PortfolioHeader({ data }: { data: PortfolioData | null }) {
  if (!data) {
    return <div className="border border-line bg-panel p-4 text-paper/40 text-sm">loading portfolio...</div>;
  }

  const pnlPositive = data.totalPnl >= 0;
  const totalReturn = ((data.currentBalance - data.startingBalance) / data.startingBalance) * 100;

  return (
    <div className="border border-line bg-panel p-4">
      <div className="text-amber text-xs tracking-widest uppercase mb-3">◆ paper trading bot — live track record</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Stat label="balance" value={`$${data.currentBalance.toFixed(2)}`} />
        <Stat
          label="total p&l"
          value={`${pnlPositive ? "+" : ""}$${data.totalPnl.toFixed(2)}`}
          color={pnlPositive ? "text-green" : "text-red"}
        />
        <Stat
          label="return"
          value={`${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(2)}%`}
          color={totalReturn >= 0 ? "text-green" : "text-red"}
        />
        <Stat label="win rate" value={`${(data.winRate * 100).toFixed(1)}%`} />
        <Stat label="trades" value={`${data.openCount} open / ${data.closedCount} closed`} />
      </div>
    </div>
  );
}

function Stat({ label, value, color = "text-paper" }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] text-paper/40 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}
