declare module 'speakeasy' {
  interface TotpStatic {
    (options: { secret: string; encoding?: string; digits?: number; step?: number }): string
    verify(options: {
      secret: string
      encoding?: string
      token: string
      window?: number
    }): boolean
  }
  interface SpeakeasyStatic {
    totp: TotpStatic
    generateSecret(options?: { name?: string; length?: number }): {
      ascii: string
      hex: string
      base32: string
      otpauth_url?: string
    }
  }
  const speakeasy: SpeakeasyStatic
  export default speakeasy
}
