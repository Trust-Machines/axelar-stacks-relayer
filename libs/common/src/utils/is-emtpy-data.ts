export function isEmptyData(data?: string) {
  if (!data) {
    return true;
  }

  if (data.length === 0 || data === '0x') {
    return true;
  }

  return false;
}
