import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, migrationArgs } from "./db-migrate.mjs";

const env = { OFS_DATABASE_URL: "postgresql://postgres:private%40password@db:5432/postgres" };

test("missing or invalid connection prevents running migrations", () => {
  for (const value of [undefined, "", "invalid", "https://example.com", "postgres:///db"]) {
    let ran = false;
    assert.throws(() => migrate({ env: { OFS_DATABASE_URL: value }, run: () => { ran = true; } }), /OFS_DATABASE_URL/);
    assert.equal(ran, false);
  }
});

test("uses migration history without resetting or reseeding", () => {
  assert.deepEqual(migrationArgs(env), ["db", "push", "--db-url", env.OFS_DATABASE_URL, "--yes"]);
  const messages = [];
  migrate({ env, log: message => messages.push(message), run: (command, args) => {
    assert.equal(command, "./node_modules/.bin/supabase");
    assert.deepEqual(args, migrationArgs(env));
    return { status: 0, stdout: "Remote database is up to date." };
  } });
  assert.equal(messages.at(-1), "Database migrations complete.");
});

test("failed migrations block startup and redact credentials", () => {
  const messages = [];
  assert.throws(() => migrate({ env, log: message => messages.push(message), run: () => ({
    status: 1, stderr: `${env.OFS_DATABASE_URL} private%40password private@password`,
  }) }), /app has not started/);
  assert.ok(!messages.join(" ").includes("password"));
});

test("CLI launch failure blocks startup", () => {
  assert.throws(() => migrate({ env, log: () => {}, run: () => ({ status: null, error: new Error("ENOENT") }) }), /migrations failed/);
});
