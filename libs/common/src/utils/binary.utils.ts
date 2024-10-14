export class BinaryUtils {
  static base64Encode(str: string) {
    return Buffer.from(str).toString('base64');
  }

  static stringToHex(str: string): string {
    return Buffer.from(str).toString('hex');
  }

  static hexToString(str: string): string {
    const hexString = str.startsWith('0x') ? str.slice(2) : str;
    return Buffer.from(hexString, 'hex').toString('utf-8');
  }
}
