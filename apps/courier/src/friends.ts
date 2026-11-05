import { randomToken } from "@courier/shared";
import { type Courier, db, type Human, listCouriers } from "./db.ts";
import { firstName } from "./pages/shared.ts";

/**
 * People a person knows on Courier: real accounts, unlike the made-up contacts the demo starts with. Each person has
 * one link that adds them; whoever opens it and says yes becomes their friend, both ways. Friends see each other's
 * first name and courier, and a courier can invite them to a run by name. Nothing about money is shared.
 */

export interface Friendship {
  id: string;
  a: string;
  b: string;
  since: string;
}

export interface Friend {
  human: Human;
  name: string;
  courier: Courier | undefined;
}

const pairId = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** The person's own link token, made the first time they need it. */
export function friendToken(human: Human): string {
  if (human.friendToken) return human.friendToken;
  const token = randomToken(18);
  db.update<Human>("humans", human.id, (h) => ({ ...h, friendToken: h.friendToken ?? token }));
  return db.get<Human>("humans", human.id)?.friendToken ?? token;
}

export function humanByFriendToken(token: string): Human | undefined {
  if (!/^[\w-]{16,64}$/.test(token)) return undefined;
  return db.list<Human>("humans", (h) => h.friendToken === token, 1)[0];
}

export const areFriends = (x: string, y: string) => Boolean(db.get<Friendship>("friends", pairId(x, y)));

export function befriend(x: Human, y: Human): void {
  if (x.id === y.id || areFriends(x.id, y.id)) return;
  const id = pairId(x.id, y.id);
  db.put<Friendship>("friends", id, { id, a: x.id, b: y.id, since: new Date().toISOString() });
}

export function unfriend(x: string, y: string): void {
  db.delete("friends", pairId(x, y));
}

export function friendsOf(humanId: string): Friend[] {
  return db
    .list<Friendship>("friends", (f) => f.a === humanId || f.b === humanId, Infinity)
    .map((f) => db.get<Human>("humans", f.a === humanId ? f.b : f.a))
    .filter((h): h is Human => Boolean(h))
    .map((human) => ({
      human,
      name: firstName(human) ?? "Someone",
      courier: listCouriers(human.id).find((c) => !c.revokedAt),
    }))
    .sort((p, q) => p.name.localeCompare(q.name));
}

/** Friends the courier can invite, in one line. */
export const friendLine = (friends: Friend[]) =>
  friends
    .filter((f) => f.courier)
    .map((f) => `${f.name} (courier ${f.courier!.name})`)
    .join(", ");
