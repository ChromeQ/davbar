// Reading the tap's JSON answers, shared by everything that asks it something.

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isNumberOrNull = (value: unknown): value is number | null =>
  typeof value === 'number' || value === null;

export const readDeviceJson = async (response: Response): Promise<Record<string, unknown>> => {
  const body = await response.text();

  if (!body) {
    throw new Error('The device closed the connection without returning a response.');
  }

  let result: unknown;

  try {
    result = JSON.parse(body);
  } catch {
    throw new Error('The device returned an invalid response.');
  }

  if (!isObject(result)) {
    throw new Error('The device returned an invalid response.');
  }

  return result;
};

// For `pnpm dev`, where there is no device: made-up answers arrive after a moment,
// like real ones.
export const developmentDelay = () => new Promise((resolve) => window.setTimeout(resolve, 300));
