export const MAX_CONTRACT_NAME_LENGTH = 53;

export function buildContractName(name: string) {
  const sanitizedName = name.toLowerCase().replace(/\s+/g, '-');
  const maxNameLength = MAX_CONTRACT_NAME_LENGTH - `${Date.now()}`.length - 1; // Adjust for timestamp and hyphen
  const trimmedName = sanitizedName.length > maxNameLength ? sanitizedName.slice(0, maxNameLength) : sanitizedName;
  return `${trimmedName}-${Date.now()}`;
}
