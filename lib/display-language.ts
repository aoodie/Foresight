const conditionNames: Record<string, string> = {
  strong_trend: 'A clear, sustained price direction',
  weak_trend: 'A price direction with frequent setbacks',
  range: 'Price moving sideways between recent boundaries',
  ranging: 'Price moving sideways between recent boundaries',
  compression: 'Small, quiet price moves',
  volatility_expansion: 'Price swings getting larger',
  news_driven: 'Important news may be driving prices',
  uncertain: 'Not enough evidence to describe conditions',
  trending: 'Price moving consistently in one direction',
  breakout: 'Price moving beyond a recent boundary',
  volatile: 'Unusually large price swings',
};
export function conditionLabel(value: string) { return conditionNames[value] ?? value.replaceAll('_', ' '); }
