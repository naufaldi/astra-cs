/** Compare a workshop key without a direct string equality check. */
export async function workshopKeyMatches(provided: string, expected: string): Promise<boolean> {
  if (expected === "" || provided === "") {
    return false;
  }
  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const left = await digest(provided);
  const right = await digest(expected);
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}
