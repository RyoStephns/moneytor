import dotenv from "dotenv";

dotenv.config();

type Config = {
  port: number;
  mysql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  defaultCurrency: string;
  allowedCidrs: string[];
  trustProxy: boolean | number | string;
  setupToken: string | undefined;
  publicBaseUrl: URL;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

// "true" used to mean trust every hop, which lets any client fake its IP through
// X-Forwarded-For and walk past the login rate limit. It now means the nginx on this box.
// A hop count or subnet (e.g. 1, 10.0.0.0/8) passes through for other setups.
function trustProxySetting(): boolean | number | string {
  const value = process.env.TRUST_PROXY?.trim().toLowerCase();
  if (!value || ["1", "true", "yes", "on"].includes(value)) return "loopback";
  if (["0", "false", "no", "off"].includes(value)) return false;
  return /^\d+$/.test(value) ? Number(value) : value;
}

function optionalCsv(name: string): string[] {
  const value = process.env[name];
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config: Config = {
  port: optionalNumber("PORT", 3000),
  mysql: {
    host: required("MYSQL_HOST"),
    port: optionalNumber("MYSQL_PORT", 3306),
    user: required("MYSQL_USER"),
    password: required("MYSQL_PASSWORD"),
    database: required("MYSQL_DATABASE")
  },
  defaultCurrency: normalizeCurrency(process.env.DEFAULT_CURRENCY || "IDR"),
  allowedCidrs: optionalCsv("ALLOWED_CIDRS"),
  trustProxy: trustProxySetting(),
  setupToken: process.env.SETUP_TOKEN?.trim() || undefined,
  publicBaseUrl: new URL(required("PUBLIC_BASE_URL"))
};

function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error("DEFAULT_CURRENCY must be a 3-letter ISO currency code");
  }

  return normalized;
}
