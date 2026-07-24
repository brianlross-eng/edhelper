import type { ShipState, TradeRoute } from '@edhelper/engine';
import type { ActiveRoute, PlotTradeRequest, PlotTradeResponse } from '../../../shared/ipc-types';

export interface TradePlannerProps {
  ship: ShipState | null;
  route: ActiveRoute | null;
  onPlot: (req: PlotTradeRequest) => Promise<PlotTradeResponse>;
  onStart: (route: TradeRoute) => void;
  onClear: () => void;
}

export function TradePlanner(_props: TradePlannerProps) {
  return <div className="muted">Trade planner loading…</div>;
}
