import { authenticator } from "otplib";

export function generateTotpSecret() {
  return authenticator.generateSecret();
}

export function otpauthUrl(params: { email: string; secret: string; issuer: string }) {
  return authenticator.keyuri(params.email, params.issuer, params.secret);
}

export function verifyTotp(params: { token: string; secret: string }) {
  return authenticator.verify({ token: params.token, secret: params.secret });
}

