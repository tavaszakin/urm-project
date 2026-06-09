const INITIAL_PRIMES = [2n];

export function nthPrime(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Prime index must be a nonnegative integer.");
  }

  let candidate = INITIAL_PRIMES[INITIAL_PRIMES.length - 1] + 1n;

  while (INITIAL_PRIMES.length <= index) {
    let isPrime = true;
    for (let divisor = 2n; divisor * divisor <= candidate; divisor += 1n) {
      if (candidate % divisor === 0n) {
        isPrime = false;
        break;
      }
    }

    if (isPrime) {
      INITIAL_PRIMES.push(candidate);
    }

    candidate += 1n;
  }

  return INITIAL_PRIMES[index];
}

export function normalizeNaturalBigInt(value) {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error("Expected a natural number.");
    return value;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Expected a natural number.");
  }

  return BigInt(value);
}

export function encodeTuple(values) {
  const tupleValues = Array.isArray(values) ? values : [];

  return tupleValues.reduce((result, value, index) => {
    const base = nthPrime(index);
    const exponent = normalizeNaturalBigInt(value) + 1n;
    return result * (base ** exponent);
  }, 1n);
}

export function tuplePrimeFactorization(values) {
  const tupleValues = Array.isArray(values) ? values : [];

  return tupleValues.map((value, index) => ({
    prime: nthPrime(index),
    exponent: normalizeNaturalBigInt(value) + 1n,
  }));
}

export function tuplePrimeFactorForm(values) {
  const factors = tuplePrimeFactorization(values);

  if (factors.length === 0) return "1";

  return factors
    .map(({ prime, exponent }) => `${prime.toString()}^${exponent.toString()}`)
    .join(" * ");
}

export function tupleLatex(values) {
  const tupleValues = Array.isArray(values) ? values : [];
  return `\\left\\langle ${tupleValues.map((value) => value.toString()).join(",")} \\right\\rangle`;
}

export function primeFactorLatexFromValues(values) {
  const factors = tuplePrimeFactorization(values);

  if (factors.length === 0) return "1";

  return factors
    .map(({ prime, exponent }) => `${prime.toString()}^{${exponent.toString()}}`)
    .join("\\cdot ");
}

export function estimateTupleDecimalDigits(values, cap = null) {
  const tupleValues = Array.isArray(values) ? values : [];
  if (tupleValues.length === 0) return 1;

  let logSum = 0;
  for (let index = 0; index < tupleValues.length; index += 1) {
    const value = normalizeNaturalBigInt(tupleValues[index]);
    const exponent = Number(value + 1n);
    const base = Number(nthPrime(index));
    logSum += exponent * Math.log10(base);

    if (cap !== null && logSum >= cap) {
      return cap + 1;
    }
  }

  return Math.floor(logSum) + 1;
}

export function buildLengthDivisibilityChecks(values) {
  const code = encodeTuple(values);
  const length = Array.isArray(values) ? values.length : 0;

  return Array.from({ length: length + 1 }, (_, index) => {
    const prime = nthPrime(index);
    return {
      index,
      prime,
      divides: code % prime === 0n,
    };
  });
}
