import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createServer, type Server } from "node:http";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/auth/password";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as assignedTrip } from "@/app/api/vehicle/trip/route";
import { PATCH as location } from "@/app/api/vehicle/location/route";
import { PATCH as stop } from "@/app/api/vehicle/stops/[stopId]/route";
import { createRobotClient } from "./simulator";
try { process.loadEnvFile(".env.test.local"); } catch { /* Optional local test settings. */ }
const url = process.env.SUPABASE_TEST_URL, key = process.env.SUPABASE_TEST_SECRET_KEY;
if (url && !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(url)) throw new Error("Local test database required");
const runFile = promisify(execFile);

describe.skipIf(!url || !key)("robot CLI over HTTP with real API handlers and local Postgres", () => {
  let db: SupabaseClient, server: Server, origin: string;
  const customer = randomUUID(), robot = randomUUID(), vehicle = randomUUID(), trip = randomUUID(), order = randomUUID(), stopId = randomUUID();
  const email = `robot-simulator-${robot}@test.local`, customerEmail = `robot-simulator-${customer}@test.local`, password = randomUUID();
  beforeAll(async () => {
    db = createClient(url!, key!, { auth: { persistSession: false } });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url!);
    vi.stubEnv("SUPABASE_SECRET_KEY", key!);
    const passwordHash = await hashPassword(password);
    for (const [table, rows] of [
      ["users", [{ id: customer, email: customerEmail, password_hash: passwordHash, role: "CUSTOMER" },
        { id: robot, email, password_hash: passwordHash, role: "VEHICLE" }]],
      ["vehicles", [{ id: vehicle, user_id: robot, status: "AVAILABLE" }]],
      ["trips", [{ id: trip, status: "ROUTED", order_count: 1, total_weight: 100,
        route_geometry: { type: "LineString", coordinates: [[-121.88, 37.33], [-121.89, 37.34]] } }]],
      ["orders", [{ id: order, customer_id: customer, trip_id: trip, status: "BATCHED", total_weight: 100,
        paid_at: new Date().toISOString(), delivery_address: {}, location: "SRID=4326;POINT(-121.89 37.34)" }]],
      ["delivery_stops", [{ id: stopId, order_id: order, trip_id: trip, stop_sequence: 1,
        location: "SRID=4326;POINT(-121.89 37.34)" }]],
    ] as const) {
      const { error } = await db.from(table).insert([...rows]); if (error) throw error;
    }
    // Only HTTP dispatch is adapted. The actual API exports, cookies, sessions,
    // role checks, services, and Postgres run without mocks. Next's own server
    // routing and middleware remain outside this test's scope.
    server = createServer(async (incoming, outgoing) => {
      try {
        const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        const request = new NextRequest(new URL(incoming.url ?? "/", origin), { method: incoming.method, headers,
          ...(!["GET", "HEAD"].includes(incoming.method ?? "GET") ? { body: Buffer.concat(chunks).toString() } : {}) });
        let response: Response;
        switch (new URL(request.url).pathname) {
          case "/api/auth/login": response = await login(request); break;
          case "/api/vehicle/trip": response = await assignedTrip(request); break;
          case "/api/vehicle/location": response = await location(request); break;
          case `/api/vehicle/stops/${stopId}`: response = await stop(request, { params: Promise.resolve({ stopId }) }); break;
          default: response = new Response(null, { status: 404 });
        }
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(await response.text());
      } catch { outgoing.writeHead(500); outgoing.end(); }
    });
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP fixture did not bind");
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    }
    vi.unstubAllEnvs();
    if (!db) return;
    for (const [table, column, ids] of [
      ["delivery_stops", "id", [stopId]], ["orders", "id", [order]], ["trips", "id", [trip]],
      ["vehicles", "id", [vehicle]], ["users", "id", [customer, robot]],
    ] as const) {
      const { error } = await db.from(table).delete().in(column, ids); if (error) throw error;
    }
  });
  it("rejects guests and customers at the real vehicle API", async () => {
    expect((await fetch(`${origin}/api/vehicle/trip`)).status).toBe(401);
    const response = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: customerEmail, password }) });
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie()[0].split(";")[0];
    expect((await fetch(`${origin}/api/vehicle/trip`, { headers: { Cookie: cookie } })).status).toBe(403);
  });
  it("runs the actual simulator CLI, completes the trip, and safely replays after release", async () => {
    const departure = await db.rpc("delivery_dispatch_trip", { p_trip_id: trip, p_vehicle_id: vehicle });
    expect(departure.error).toBeNull(); expect(departure.data).toBe(vehicle);
    const args = [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/robot-simulator.ts"), "--once"];
    const options = { timeout: 15000, env: { ...process.env, OFS_ROBOT_BASE_URL: origin,
      OFS_ROBOT_EMAIL: email, OFS_ROBOT_PASSWORD: password, OFS_ROBOT_STEP_MS: "0" } };
    expect((await runFile(process.execPath, args, options)).stdout).toContain("1 delivery acknowledgements");
    expect((await runFile(process.execPath, args, options)).stdout).toContain("No assigned trip");
    expect((await db.from("trips").select("status,vehicle_id").eq("id", trip).single()).data)
      .toEqual({ status: "COMPLETED", vehicle_id: vehicle });
    expect((await db.from("vehicles").select("status,current_trip_id,last_location").eq("id", vehicle).single()).data)
      .toMatchObject({ status: "AVAILABLE", current_trip_id: null, last_location: expect.any(String) });
    expect((await db.from("order_status_history").select("status").eq("order_id", order).order("changed_at")).data)
      .toEqual([{ status: "OUT_FOR_DELIVERY" }, { status: "DELIVERED" }]);
    expect((await db.rpc("delivery_dispatch_trip", { p_trip_id: trip, p_vehicle_id: vehicle })).data).toBe(vehicle);
    await createRobotClient({ baseUrl: origin, email, password }).stop(stopId, "DELIVERED");
  }, 35000);
});
