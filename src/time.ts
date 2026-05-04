const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function nowForMysql(): string {
  return toMysqlDateTime(new Date());
}

export function parseInputDate(value: string | undefined, fallback = new Date()): string {
  if (!value) {
    return toMysqlDateTime(fallback);
  }

  if (dateOnlyPattern.test(value)) {
    return `${value} 00:00:00.000`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }

  return toMysqlDateTime(date);
}

export function parseStartDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (dateOnlyPattern.test(value)) {
    return `${value} 00:00:00.000`;
  }

  return parseInputDate(value);
}

export function parseEndDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (dateOnlyPattern.test(value)) {
    return `${value} 23:59:59.999`;
  }

  return parseInputDate(value);
}

export function toMysqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}
