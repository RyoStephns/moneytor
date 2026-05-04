import type { Request, Response, NextFunction } from "express";

type ParsedCidr = {
  base: number;
  mask: number;
};

function ipv4ToNumber(ip: string): number | undefined {
  const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = normalized.split(".");
  if (parts.length !== 4) {
    return undefined;
  }

  let result = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return undefined;
    }
    result = (result << 8) + octet;
  }

  return result >>> 0;
}

function parseCidr(cidr: string): ParsedCidr | undefined {
  const [ip, prefixText] = cidr.split("/");
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  const base = ipv4ToNumber(ip);

  if (base === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return undefined;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: base & mask, mask };
}

export function isIpAllowed(ip: string, cidrs: string[]): boolean {
  if (cidrs.length === 0) {
    return true;
  }

  const numericIp = ipv4ToNumber(ip);
  if (numericIp === undefined) {
    return ip === "::1" && cidrs.includes("::1/128");
  }

  return cidrs.some((cidr) => {
    const parsed = parseCidr(cidr);
    return parsed ? (numericIp & parsed.mask) === parsed.base : false;
  });
}

export function createIpAllowlistMiddleware(cidrs: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const requestIp = request.ip ?? request.socket.remoteAddress ?? "";
    if (!isIpAllowed(requestIp, cidrs)) {
      response.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}
