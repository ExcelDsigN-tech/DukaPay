"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useLocale } from "next-intl";
import { formatCurrency } from "../../utils/formatLocale";

export interface YieldDataPoint {
  date: string;
  earnings: number;
  apy: number;
  principal?: number;
}

interface YieldEarningsChartProps {
  data: YieldDataPoint[];
  className?: string;
}

export function YieldEarningsChart({ data, className }: YieldEarningsChartProps) {
  const locale = useLocale();
  const totalEarnings = data.reduce((sum, point) => sum + point.earnings, 0);
  // Yield-history APY is already a percentage (e.g. 11.94), not a fraction.
  const avgAPY =
    data.length > 0
      ? (data.reduce((sum, point) => sum + point.apy, 0) / data.length).toFixed(2)
      : "0.00";

  // Format currency using locale-aware utility (see issue #536)
  const fmtCurrency = (value: number) => formatCurrency(value, locale);

  return (
    <section className={`rounded-2xl border border-line bg-surface p-6 ${className ?? ""}`.trim()}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-fg">Yield earnings</h2>
          <p className="mt-1 text-xs text-fg-muted">Daily earnings over the period</p>
        </div>
        <dl className="flex gap-8">
          <div>
            <dt className="text-xs text-fg-muted">Total earnings</dt>
            <dd className="mt-1 text-xl font-medium tabular-nums text-fg">
              {fmtCurrency(totalEarnings)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">Average APY</dt>
            <dd className="mt-1 text-xl font-medium tabular-nums text-fg">{avgAPY}%</dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 text-xs text-fg-muted">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} className="stroke-line" />
            <XAxis
              dataKey="date"
              className="font-mono"
              tick={{ fill: "currentColor" }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              className="font-mono"
              tick={{ fill: "currentColor" }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(value: number) => fmtCurrency(value)}
            />
            <Tooltip
              cursor={{ className: "stroke-line-strong" }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts Tooltip callback type
              content={({ active, payload }: any) => {
                if (active && payload && payload.length) {
                  const item = (payload[0] as unknown as { payload: YieldDataPoint }).payload;
                  return (
                    <div className="rounded-lg border border-line bg-surface p-3 text-xs shadow-sm">
                      <p className="font-medium text-fg">{item.date}</p>
                      <p className="mt-1 tabular-nums text-fg-muted">
                        Earnings <span className="text-fg">{fmtCurrency(item.earnings)}</span>
                      </p>
                      <p className="tabular-nums text-fg-muted">
                        APY <span className="text-fg">{item.apy.toFixed(2)}%</span>
                      </p>
                      {item.principal ? (
                        <p className="tabular-nums text-fg-muted">
                          Principal <span className="text-fg">{fmtCurrency(item.principal)}</span>
                        </p>
                      ) : null}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Area
              type="monotone"
              dataKey="earnings"
              stroke="currentColor"
              strokeWidth={2}
              fill="currentColor"
              fillOpacity={0.08}
              name="Earnings"
              className="text-primary"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
