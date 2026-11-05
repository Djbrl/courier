import { type CourierColor, config, newId, randomToken, SHOPS, type Shop } from "@courier/shared";
import { type Courier, db, type Human } from "./db.ts";
import { firstName } from "./pages/shared.ts";

/**
 * A run: one errand that several people do together, each with their own courier. Someone starts it from a chat and
 * shares its link; whoever opens it signs in, joins with their courier, and gets a chat of their own. The couriers talk
 * in a thread every member sees. Each person still buys their own things on their own errand, with their own budget and
 * their own PayPal, so nothing here can spend for anyone.
 */

export const RUN_MEMBERS_MAX = 4;
const RUN_HOURS = 24;
/** What one courier can say to the others in one go. Long enough for an order, short enough to read at a glance. */
export const RUN_LINE_MAX = 280;

export interface RunMember {
  humanId: string;
  courierId: string;
  chatId: string;
  name: string;
  courierName: string;
  color: CourierColor;
  host?: boolean;
  joinedAt: string;
  /** They ended their chat. They stay on the list, so everyone sees who was in it, but hear nothing more. */
  leftAt?: string;
}

export type RunLine =
  | { t: "say"; by: string; text: string; at: string }
  | { t: "joined"; by: string; at: string }
  | { t: "order"; by: string; items: string[]; total: string; at: string }
  | { t: "paid"; by: string; total: string; at: string }
  | { t: "left"; by: string; at: string };

export interface Run {
  id: string;
  /** The secret in the invite link. Anyone holding it can join until the run is full or over. */
  token: string;
  what: string;
  shop: string | null;
  /** What the person who starts it says to whoever opens the link, in their courier's words. */
  note: string;
  members: RunMember[];
  /** Friends asked by name. They see the invitation in their own Courier until they join or it ends. */
  invited?: string[];
  lines: RunLine[];
  rev: number;
  createdAt: string;
  expiresAt: string;
}

export const runUrl = (run: Run) => `${config.courier.url}/run/${run.token}`;
export const runShop = (run: Run): Shop | undefined => SHOPS.find((s) => s.slug === run.shop);
export const runOpen = (run: Run) => Date.parse(run.expiresAt) > Date.now();
/** Members still in it: whoever has left hears nothing more. */
export const present = (run: Run) => run.members.filter((m) => !m.leftAt);
export const runFull = (run: Run) => present(run).length >= RUN_MEMBERS_MAX;
export const memberOf = (run: Run, humanId: string) => run.members.find((m) => m.humanId === humanId);
export const getRun = (id: string | undefined) => (id ? db.get<Run>("runs", id) : undefined);

export function runByToken(token: string): Run | undefined {
  if (!/^[\w-]{16,64}$/.test(token)) return undefined;
  return db.list<Run>("runs", (r) => r.token === token, 1)[0];
}

export function member(human: Human, courier: Courier, chatId: string, host = false): RunMember {
  return {
    humanId: human.id,
    courierId: courier.id,
    chatId,
    name: firstName(human) ?? "Someone",
    courierName: courier.name,
    color: courier.color,
    ...(host ? { host: true } : {}),
    joinedAt: new Date().toISOString(),
  };
}

export function newRun(host: RunMember, what: string, shop: Shop | undefined, note: string): Run {
  const id = newId("run");
  const now = Date.now();
  return db.put<Run>("runs", id, {
    id,
    token: randomToken(18),
    what,
    shop: shop?.slug ?? null,
    note,
    members: [host],
    lines: [],
    rev: 0,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + RUN_HOURS * 3600_000).toISOString(),
  });
}

/**
 * Changes a run from its stored copy. Several chats write to one run, each in its own turn, so each change starts
 * from what's stored now rather than from a copy read earlier.
 */
export function changeRun(id: string, change: (run: Run) => void): Run | undefined {
  return db.update<Run>("runs", id, (run) => {
    change(run);
    run.rev++;
    return run;
  });
}

export const addLine = (id: string, line: RunLine) => changeRun(id, (run) => void run.lines.push(line));

const who = (run: Run, humanId: string) => run.members.find((m) => m.humanId === humanId);

/** Where each person is: nothing yet, an order waiting for their PayPal, or paid. */
function standing(run: Run, humanId: string): { state: "none" | "ordered" | "paid"; total?: string } {
  let out: ReturnType<typeof standing> = { state: "none" };
  for (const line of run.lines)
    if (line.by === humanId && line.t === "order") out = { state: "ordered", total: line.total };
    else if (line.by === humanId && line.t === "paid") out = { state: "paid", total: line.total };
  return out;
}

/** What a member's window shows. The link is there for every member, so anyone in it can bring someone else. */
export function runView(run: Run, humanId: string) {
  return {
    id: run.id,
    what: run.what,
    shop: runShop(run)?.name ?? null,
    url: runUrl(run),
    open: runOpen(run),
    full: runFull(run),
    rev: run.rev,
    members: run.members.map((m) => ({
      name: m.name,
      courier: m.courierName,
      color: m.color,
      you: m.humanId === humanId,
      host: Boolean(m.host),
      left: Boolean(m.leftAt),
      ...standing(run, m.humanId),
    })),
    invited: (run.invited ?? [])
      .filter((id) => !memberOf(run, id))
      .map((id) => firstName(db.get<Human>("humans", id) ?? null) ?? "Someone"),
    lines: run.lines.slice(-40).map((line) => {
      const m = who(run, line.by);
      return { ...line, by: undefined, name: m?.name ?? "", courier: m?.courierName ?? "", you: line.by === humanId };
    }),
  };
}

const quote = (text: string) => `"${text.replace(/\s+/g, " ").slice(0, 200)}"`;

/** Runs a friend asked this person to, which they haven't joined. */
export function invitesFor(humanId: string) {
  return db
    .list<Run>(
      "runs",
      (r) => Boolean(r.invited?.includes(humanId)) && runOpen(r) && !memberOf(r, humanId) && !runFull(r),
    )
    .map((r) => {
      const host = r.members.find((m) => m.host) ?? r.members[0]!;
      return { what: r.what, shop: runShop(r)?.name ?? null, from: host.name, note: r.note, url: `/run/${r.token}` };
    });
}

/** The run in one line, for the courier. Lines from other couriers are quoted as theirs, never as instructions. */
export function runState(run: Run, humanId: string): string {
  const others = present(run).filter((m) => m.humanId !== humanId);
  const gone = run.members.filter((m) => m.leftAt && m.humanId !== humanId).map((m) => m.name);
  const people = others.length
    ? others
        .map((m) => {
          const s = standing(run, m.humanId);
          return `${m.name} (courier ${m.courierName}${s.state === "paid" ? `, paid $${s.total}` : s.state === "ordered" ? `, ordered $${s.total}, not paid yet` : ""})`;
        })
        .join(", ")
    : "nobody has joined yet";
  const lines = run.lines
    .filter((l) => l.t === "say")
    .slice(-8)
    .map((l) => `${who(run, l.by)?.courierName ?? "?"}: ${quote((l as { text: string }).text)}`)
    .join("; ");
  const shop = runShop(run);
  return (
    `a run, "${run.what}"${shop ? ` at ${shop.name}` : ""}, with ${people}. ` +
    `${run.members.find((m) => m.humanId === humanId)?.host ? "They started it." : "They joined it."} ` +
    `${gone.length ? `${gone.join(" and ")} left. ` : ""}` +
    `Thread so far: ${lines || "empty"}`
  );
}
