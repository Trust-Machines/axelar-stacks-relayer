export class BinaryUtils {
  static base64Encode(str: string) {
    return Buffer.from(str).toString('base64');
  }

  static stringToHex(str: string): string {
    return Buffer.from(str).toString('hex');
  }

  static hexToString(str: string): string {
    const cleanHex = this.removeHexPrefix(str);
    return Buffer.from(cleanHex, 'hex').toString('utf-8');
  }

  static base64ToHex(base64: string): string {
    return Buffer.from(base64, 'base64').toString('hex');
  }

  static hexToBase64(hex: string): string {
    const cleanHex = this.removeHexPrefix(hex);
    return Buffer.from(cleanHex, 'hex').toString('base64');
  }

  static hexToBuffer(hexString: string): Buffer {
    const cleanHex = this.removeHexPrefix(hexString);
    return Buffer.from(cleanHex, 'hex');
  }

  static removeHexPrefix(str: string): string {
    return str.startsWith('0x') ? str.slice(2) : str;
  }

  static addHexPrefix(str: string): string {
    return str.startsWith('0x') ? str : `0x${str}`;
  }
}
