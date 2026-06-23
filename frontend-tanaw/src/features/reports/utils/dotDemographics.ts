export type DotDemographics = {
  provMale: number;
  provFemale: number;
  provTotal: number;
  otherMale: number;
  otherFemale: number;
  otherTotal: number;
  foreignMale: number;
  foreignFemale: number;
  foreignTotal: number;
  grandMale: number;
  grandFemale: number;
};

export function getDotDemographics(total: number): DotDemographics {
  const provMale = Math.floor(total * 0.65 * 0.48);
  const provFemale = Math.floor(total * 0.65 * 0.52);
  const provTotal = provMale + provFemale;
  const otherMale = Math.floor(total * 0.25 * 0.5);
  const otherFemale = Math.floor(total * 0.25 * 0.5);
  const otherTotal = otherMale + otherFemale;
  const foreignMale = Math.floor(total * 0.1 * 0.55);
  const foreignFemale = total - provTotal - otherTotal - foreignMale;
  const foreignTotal = foreignMale + foreignFemale;

  return {
    provMale,
    provFemale,
    provTotal,
    otherMale,
    otherFemale,
    otherTotal,
    foreignMale,
    foreignFemale,
    foreignTotal,
    grandMale: provMale + otherMale + foreignMale,
    grandFemale: provFemale + otherFemale + foreignFemale,
  };
}
