// DB integration tests. Run via: npm run test:db
// (sets DATABASE_URL to the dedicated test database from .env.local).
// Never run against the dev database: this file deletes all rows first.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";

before(async () => {
  await prisma.website.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
});

after(async () => {
  await prisma.website.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

test("user creation enforces unique email", async () => {
  await prisma.user.create({
    data: { name: "Alice", email: "alice@example.com", emailVerified: false },
  });
  await assert.rejects(
    () => prisma.user.create({
      data: { name: "Alice 2", email: "alice@example.com", emailVerified: false },
    }),
    (err) => err.code === "P2002"
  );
  const found = await prisma.user.findUnique({ where: { email: "alice@example.com" } });
  assert.equal(found.name, "Alice");
  assert.equal(found.role, "USER");
});

test("website CRUD, per-user dedupe, and ownership scoping", async () => {
  const alice = await prisma.user.findUnique({ where: { email: "alice@example.com" } });
  const bob = await prisma.user.create({
    data: { name: "Bob", email: "bob@example.com", emailVerified: false },
  });
  const site = await prisma.website.create({
    data: { name: "Alice Site", normalizedUrl: "https://example.com", userId: alice.id },
  });
  assert.equal(site.connectionStatus, "NOT_CONNECTED");
  // Same user, same URL -> unique violation.
  await assert.rejects(
    () => prisma.website.create({
      data: { name: "Dup", normalizedUrl: "https://example.com", userId: alice.id },
    }),
    (err) => err.code === "P2002"
  );
  // Different user may register the same URL.
  await prisma.website.create({
    data: { name: "Bob Site", normalizedUrl: "https://example.com", userId: bob.id },
  });
  // Ownership scoping: Bob's query for Alice's row returns null.
  const leaked = await prisma.website.findFirst({ where: { id: site.id, userId: bob.id } });
  assert.equal(leaked, null);
  const owned = await prisma.website.findFirst({ where: { id: site.id, userId: alice.id } });
  assert.equal(owned.id, site.id);
  // Update + delete.
  const updated = await prisma.website.update({ where: { id: site.id }, data: { name: "Renamed" } });
  assert.equal(updated.name, "Renamed");
  await prisma.website.delete({ where: { id: site.id } });
  assert.equal(await prisma.website.findUnique({ where: { id: site.id } }), null);
});

test("deleting a user cascades to their websites", async () => {
  const carol = await prisma.user.create({
    data: { name: "Carol", email: "carol@example.com", emailVerified: false },
  });
  await prisma.website.create({
    data: { name: "Carol Site", normalizedUrl: "https://carol.example", userId: carol.id },
  });
  await prisma.user.delete({ where: { id: carol.id } });
  assert.equal(
    await prisma.website.count({ where: { userId: carol.id } }),
    0
  );
});
