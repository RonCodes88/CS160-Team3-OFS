import { hash, verify } from "@node-rs/argon2";

// Argon2id with the library defaults (19 MiB memory, 2 passes), which match
// the OWASP recommendation. Only the encoded hash is stored.

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/** False for a wrong password or a hash this module can't read. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Verified against when the email is unknown, so a login takes about as long
// whether or not the account exists.
let dummyHash: Promise<string> | undefined;

export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hash("ofs-dummy-password");
  await verifyPassword(await dummyHash, password);
}
