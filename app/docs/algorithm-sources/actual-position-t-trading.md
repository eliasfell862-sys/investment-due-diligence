# Actual-position T-trading algorithm sources

The browser and resident worker use a deterministic TypeScript implementation. They do not start or import the downloaded Python application at runtime.

Source ideas reviewed while defining the adapter:

- `daily_stock_analysis/src/stock_analyzer.py::_analyze_support_resistance`: moving-average support and recent-high resistance structure.
- `daily_stock_analysis/src/analyzer.py`: support/resistance confirmation and capital-flow stability rules.
- `daily_stock_analysis/src/utils/sniper_points.py`: structured take-profit and risk-point output contract.
- `app/src/engines/market-analysis/technical-indicators.ts`: existing TypeScript MA, OBV, and ATR calculations.

The T-trading adapter adds ATRP20, annualized 20-day log-return volatility, volume ratio, OBV slope, quote freshness, and conservative data-quality states. These calculations are independently tested and remain isolated from the individual stock-analysis and K-line rendering paths.
