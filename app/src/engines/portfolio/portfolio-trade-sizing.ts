import { currentBoardLotShares } from '../../features/securities/portfolio-live-pricing';

export interface PortfolioSizingInput {
  code: string;
  name: string;
  price: number;
  targetWeight: number;
}

export interface SizedPortfolioPosition extends PortfolioSizingInput {
  targetAmount: number;
  shares: number;
  actualAmount: number;
  actualWeight: number;
  weightDeviation: number;
}

export interface PortfolioSizingResult {
  positions: SizedPortfolioPosition[];
  investedAmount: number;
  actualStockWeight: number;
  minimumCashAmount: number;
  constraintCashAmount: number;
  boardLotCashAmount: number;
  totalCashAmount: number;
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const roundWeight = (value: number) => Math.round(value * 1e12) / 1e12;

export function sizePortfolioTrades(
  capital: number,
  inputs: PortfolioSizingInput[],
  minimumCashWeight: number,
  constraintCashWeight: number,
): PortfolioSizingResult {
  if (!Number.isFinite(capital) || capital <= 0) {
    return {
      positions: [], investedAmount: 0, actualStockWeight: 0,
      minimumCashAmount: 0, constraintCashAmount: 0, boardLotCashAmount: 0, totalCashAmount: 0,
    };
  }

  const minimumWeight = clamp(Number.isFinite(minimumCashWeight) ? minimumCashWeight : 0, 0, 1);
  const constraintWeight = clamp(Number.isFinite(constraintCashWeight) ? constraintCashWeight : 0, 0, 1 - minimumWeight);
  const stockBudgetWeight = Math.max(0, 1 - minimumWeight - constraintWeight);
  const validInputs = inputs.filter(input => Number.isFinite(input.price) && input.price > 0
    && Number.isFinite(input.targetWeight) && input.targetWeight > 0);
  const requestedWeight = validInputs.reduce((sum, input) => sum + input.targetWeight, 0);
  const scale = requestedWeight > stockBudgetWeight && requestedWeight > 0
    ? stockBudgetWeight / requestedWeight
    : 1;

  const positions = validInputs.map(input => {
    const targetWeight = input.targetWeight * scale;
    const targetAmount = roundMoney(capital * targetWeight);
    const shares = currentBoardLotShares(targetAmount, input.price);
    const actualAmount = roundMoney(shares * input.price);
    const actualWeight = roundWeight(actualAmount / capital);
    return {
      ...input,
      targetWeight,
      targetAmount,
      shares,
      actualAmount,
      actualWeight,
      weightDeviation: roundWeight(actualWeight - targetWeight),
    };
  });

  const investedAmount = roundMoney(positions.reduce((sum, position) => sum + position.actualAmount, 0));
  const minimumCashAmount = roundMoney(capital * minimumWeight);
  const constraintCashAmount = roundMoney(capital * constraintWeight);
  const boardLotCashAmount = roundMoney(Math.max(0, capital - investedAmount - minimumCashAmount - constraintCashAmount));
  const totalCashAmount = roundMoney(minimumCashAmount + constraintCashAmount + boardLotCashAmount);
  return {
    positions,
    investedAmount,
    actualStockWeight: roundWeight(investedAmount / capital),
    minimumCashAmount,
    constraintCashAmount,
    boardLotCashAmount,
    totalCashAmount,
  };
}
