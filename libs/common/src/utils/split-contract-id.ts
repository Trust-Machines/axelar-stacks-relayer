export const splitContractId = (contractId: string): [string, string] => {
  const contractSplit = contractId.split('.');

  return [contractSplit[0], contractSplit[1]];
};
