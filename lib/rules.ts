// Pure board rules shared by the server (enforcement) and the browser (what to show).
// Mirrors the agreed prototype: team-owned columns in line order, plus shared To do and Done lanes.

export const H = 3600e3;
export const D = 24 * H;

export type OrgRole = 'super' | 'head' | 'pm' | null;
export type Level = 'ok' | 'warn' | 'bad' | 'done' | 'todo' | 'none';
export type MoveKind = 'handover' | 'back' | 'start' | 'done' | 'reopen' | 'backlog' | undefined;

export interface Person { id: string; name: string; email: string; hue: number; orgRole: OrgRole }
export interface Team { id: string; name: string; color: string; lineOrder: number; leadId: string | null; memberIds: string[] }
export interface Column { id: string; teamId: string; name: string; position: number; estH: number; ownerIds: string[]; archived?: boolean }
export interface Subtask { id: string; title: string; deadline: number | null; done: boolean }
export interface Task {
  id: string; title: string; desc: string;
  col: string; // a column id, or 'todo' / 'done'
  created: number; entered: number; started: number | null; deadline: number | null;
  assignees: string[]; lastTeam: string | null; subtasks: Subtask[];
}
export interface ProjectShape { id: string; name: string; managerId: string; teams: Team[]; columns: Column[] }

export interface LaneCol { id: 'todo' | 'done'; name: string; todo?: true; final?: true; special: true; teamId: null; estH: 0; ownerIds: [] }
export const TODO: LaneCol = { id: 'todo', name: 'To do', todo: true, special: true, teamId: null, estH: 0, ownerIds: [] };
export const DONE: LaneCol = { id: 'done', name: 'Done', final: true, special: true, teamId: null, estH: 0, ownerIds: [] };
export type AnyCol = (Column & { special?: false; todo?: false; final?: false }) | LaneCol;

export interface Role { kind: 'pm' | 'lead' | 'member'; team?: string; admin?: boolean }

export const SWATCHES = ['--t1', '--t2', '--t3', '--t4', '--t5', '--t6'];

export const isAdminRole = (r: OrgRole) => r === 'super' || r === 'head';

export function roleIn(p: ProjectShape, who: string, orgRole: OrgRole): Role | null {
  if (isAdminRole(orgRole)) return { kind: 'pm', admin: true };
  if (p.managerId === who) return { kind: 'pm' };
  for (const t of p.teams) {
    if (t.leadId === who) return { kind: 'lead', team: t.id };
    if (t.memberIds.includes(who)) return { kind: 'member', team: t.id };
  }
  return null;
}

export class Board {
  readonly teams: Team[];
  readonly columns: Column[];
  constructor(readonly p: ProjectShape, readonly role: Role | null, readonly archived: Column[] = []) {
    this.teams = [...p.teams].sort((a, b) => a.lineOrder - b.lineOrder);
    const order = new Map(this.teams.map((t, i) => [t.id, i]));
    this.columns = p.columns.filter(c => !c.archived).sort((a, b) => (order.get(a.teamId)! - order.get(b.teamId)!) || a.position - b.position);
  }
  col(id: string): AnyCol | undefined {
    if (id === 'todo') return TODO;
    if (id === 'done') return DONE;
    return this.columns.find(c => c.id === id) ?? this.archived.find(c => c.id === id) ?? this.p.columns.find(c => c.id === id);
  }
  team(id: string | null | undefined) { return id ? this.teams.find(t => t.id === id) : undefined; }
  teamCols(tid: string) { return this.columns.filter(c => c.teamId === tid); }
  teamIdx(tid: string) { return this.teams.findIndex(t => t.id === tid); }
  get isPM() { return this.role?.kind === 'pm'; }
  canWorkIn(tid: string | null) { return this.isPM || (tid == null ? this.role?.kind === 'lead' : this.role?.team === tid); }
  canBacklog() { return this.isPM || this.role?.kind === 'lead'; }
  canCreateIn(tid: string) { return this.isPM || (this.role?.kind === 'lead' && this.role.team === tid); }
  canEditCols(tid: string) { return this.canCreateIn(tid); }
  // Names: the project name is PM and above; a team's name is its lead, or PM and above.
  canRenameProject() { return this.isPM; }
  canRenameTeam(tid: string) { return this.canCreateIn(tid); }
  // Renaming a task: the lead of the team it sits in, or PM and above. Backlog and Done tasks: any lead.
  canRenameTask(t: Task) { const tid = this.col(t.col)?.teamId ?? null; return this.isPM || (this.role?.kind === 'lead' && (tid == null || this.role.team === tid)); }
  cardTeam(t: Task) { const c = this.col(t.col); return (c && !('special' in c && c.special) ? (c as Column).teamId : null) ?? t.lastTeam; }

  moveRule(tk: Task, toId: string): { ok: boolean; kind?: MoveKind; needsComment?: boolean; needsDeadline?: boolean; why?: string } {
    const from = this.col(tk.col), to = this.col(toId);
    if (!from || !to || from.id === to.id || (to as Column).archived) return { ok: false };
    const r = this.role;
    if (!r) return { ok: false, why: 'You are not part of this project.' };
    const lead = r.kind === 'lead';
    const fromTeam = from.teamId, toTeam = to.teamId;
    if ('final' in to && to.final) {
      if (this.isPM || (lead && (('todo' in from && from.todo) || r.team === fromTeam))) return { ok: true, kind: 'done', needsComment: true };
      return { ok: false, why: 'Only a team lead or the project manager can mark a task done.' };
    }
    if ('final' in from && from.final) return this.isPM ? { ok: true, kind: 'reopen', needsDeadline: !tk.deadline } : { ok: false, why: 'Only the project manager can reopen a finished task.' };
    if ('todo' in from && from.todo) {
      if (this.isPM || (lead && r.team === toTeam)) return { ok: true, kind: 'start', needsDeadline: !tk.deadline };
      return { ok: false, why: lead ? "Leads start backlog tasks in their own team's columns." : 'Only a team lead or the project manager can start a backlog task.' };
    }
    if ('todo' in to && to.todo) {
      if (this.isPM || (lead && r.team === fromTeam)) return { ok: true, kind: 'backlog', needsComment: true };
      return { ok: false, why: 'Only the team lead or the project manager can move a task back to the backlog.' };
    }
    if (fromTeam === toTeam) {
      if (this.canWorkIn(fromTeam)) return { ok: true };
      return { ok: false, why: `Only ${this.team(fromTeam)?.name} can move cards between its columns.` };
    }
    const fi = this.teamIdx(fromTeam!), ti = this.teamIdx(toTeam!);
    const fc = this.teamCols(fromTeam!), tc = this.teamCols(toTeam!);
    const leadOfFrom = this.isPM || (lead && r.team === fromTeam);
    if (ti === fi + 1) {
      if (from.id !== fc.at(-1)!.id || to.id !== tc[0].id) return { ok: false, why: `Hand over from ${fc.at(-1)!.name} into ${tc[0].name}.` };
      if (!leadOfFrom) return { ok: false, why: `Only the ${this.team(fromTeam)?.name} lead can hand this card to ${this.team(toTeam)?.name}.` };
      return { ok: true, kind: 'handover' };
    }
    if (ti === fi - 1) {
      if (from.id !== fc[0].id || to.id !== tc.at(-1)!.id) return { ok: false, why: `Send back from ${fc[0].name} to ${tc.at(-1)!.name}.` };
      if (!leadOfFrom) return { ok: false, why: `Only the ${this.team(fromTeam)?.name} lead can send this card back.` };
      return { ok: true, kind: 'back', needsComment: true };
    }
    return { ok: false, why: 'Cards move one team at a time.' };
  }

  colStatus(tk: Task, now: number) {
    const c = this.col(tk.col)!;
    if ('final' in c && c.final) return { lv: 'done' as Level, frac: 0, left: 0 };
    if ('todo' in c && c.todo) return { lv: 'todo' as Level, frac: 0, left: 0 };
    const used = now - tk.entered, budget = c.estH * H;
    return { lv: level(used / budget), frac: used / budget, left: budget - used };
  }
  dlStatus(tk: Task, now: number) {
    if (tk.col === 'done') return { lv: 'done' as Level, frac: 0, left: 0 };
    if (!tk.deadline) return { lv: 'none' as Level, frac: 0, left: 0 };
    const from = tk.started ?? tk.created, span = tk.deadline - from, used = now - from;
    return { lv: now > tk.deadline ? 'bad' as Level : level(used / span), frac: used / span, left: tk.deadline - now };
  }
}

export const level = (frac: number): Level => frac >= 1 ? 'bad' : frac >= 0.8 ? 'warn' : 'ok';

export function fmtDur(ms: number) {
  // Round to whole minutes first so 59.6 minutes never shows as "60m".
  const mins = Math.round(Math.abs(ms) / 60000), d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}
export const left = (ms: number) => ms >= 0 ? `${fmtDur(ms)} left` : `${fmtDur(ms)} over`;
export function fmtDate(ms: number, short = false) {
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-GB', { weekday: short ? undefined : 'short', day: 'numeric', month: 'short' });
  return `${day}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
export const initials = (name: string) => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

// Organisation roles a person may hand out.
export const assignable = (r: OrgRole): Exclude<OrgRole, null>[] => r === 'super' ? ['super', 'head', 'pm'] : r === 'head' ? ['pm'] : [];
export const ORG: Record<Exclude<OrgRole, null>, string> = { super: 'Super admin', head: 'Head of projects', pm: 'Project manager' };

// Mentions are stored as plain text "@Name"; resolve against people and teams of the project.
export interface Mentionable { kind: 'user' | 'team'; id: string; name: string }
const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function mentionRe(items: Mentionable[]) {
  const names = items.map(x => x.name).sort((a, b) => b.length - a.length).map(escRe);
  return names.length ? new RegExp('@(' + names.join('|') + ')(?![\\w])', 'g') : null;
}
export function mentionsIn(text: string, items: Mentionable[]) {
  const re = mentionRe(items), out: Mentionable[] = [];
  if (!re) return out;
  for (const m of text.matchAll(re)) { const it = items.find(x => x.name === m[1]); if (it && !out.includes(it)) out.push(it); }
  return out;
}
